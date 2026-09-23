importScripts('calculus-engine.js', 'course-engine.js', 'calculator.js');

const DEFAULTS = {
  endpoint: 'http://127.0.0.1:11434',
  model: 'qwen3.5:9b',
  aiFallback: false
};

const CAPTURE_DB_NAME = 'mom-helper-question-corpus';
const CAPTURE_DB_VERSION = 1;
const CAPTURE_STORE = 'questions';

function openCaptureDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CAPTURE_DB_NAME, CAPTURE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CAPTURE_STORE)) {
        const store = db.createObjectStore(CAPTURE_STORE, { keyPath: 'fingerprint' });
        store.createIndex('lastSeenAt', 'lastSeenAt');
        store.createIndex('assignmentId', 'source.assignmentId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbRequest(req) {
  return new Promise((resolve,reject) => { req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); });
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

function captureFingerprintMaterial(snapshot) {
  const q = snapshot?.question || {};
  return JSON.stringify({
    text: q.text || '',
    answers: (q.answers || []).map(a=>({kind:a.kind,type:a.type,dataMq:a.dataMq,tip:a.tip,context:a.context,options:(a.options||[]).map(o=>o.text)})),
    choices: (q.choices || []).map(c=>c.context || ''),
    tables: q.tables || [],
    graphs: (q.graphs || []).map(g=>({dataScript:g.dataScript,labels:g.labels,points:g.points,segments:g.segments})),
    widgets: q.widgets || {},
    mathSources: snapshot?.visual?.mathSources || []
  });
}

async function putCapture(snapshot) {
  if (!snapshot?.question?.text) throw new Error('Capture has no readable question.');
  const fingerprint = await sha256Hex(captureFingerprintMaterial(snapshot));
  const db = await openCaptureDb();
  try {
    const tx = db.transaction(CAPTURE_STORE, 'readwrite');
    const store = tx.objectStore(CAPTURE_STORE);
    const existing = await idbRequest(store.get(fingerprint));
    const now = new Date().toISOString();
    const record = {
      ...snapshot,
      fingerprint,
      firstSeenAt: existing?.firstSeenAt || snapshot.capturedAt || now,
      lastSeenAt: now,
      seenCount: Number(existing?.seenCount || 0) + 1
    };
    store.put(record);
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
    return { ok:true, fingerprint, deduplicated:!!existing, seenCount:record.seenCount };
  } finally { db.close(); }
}

async function captureCount() {
  const db=await openCaptureDb();
  try { const tx=db.transaction(CAPTURE_STORE,'readonly'); return await idbRequest(tx.objectStore(CAPTURE_STORE).count()); }
  finally { db.close(); }
}

async function listCaptures() {
  const db=await openCaptureDb();
  try {
    const tx=db.transaction(CAPTURE_STORE,'readonly');
    const rows=await idbRequest(tx.objectStore(CAPTURE_STORE).getAll());
    rows.sort((a,b)=>String(a.firstSeenAt).localeCompare(String(b.firstSeenAt)));
    return rows;
  } finally { db.close(); }
}

async function clearCaptures() {
  const db=await openCaptureDb();
  try {
    const tx=db.transaction(CAPTURE_STORE,'readwrite');
    tx.objectStore(CAPTURE_STORE).clear();
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
    return {ok:true};
  } finally { db.close(); }
}

function normalizeBaseUrl(url) {
  return String(url || DEFAULTS.endpoint).trim().replace(/\/+$/, '');
}

async function getSettings() {
  const stored = await chrome.storage.local.get(['solverEndpoint', 'solverModel', 'aiFallback']);
  return {
    endpoint: normalizeBaseUrl(stored.solverEndpoint || DEFAULTS.endpoint),
    model: String(stored.solverModel || DEFAULTS.model).trim() || DEFAULTS.model,
    aiFallback: stored.aiFallback === true
  };
}

function extractJson(text) {
  const raw = String(text || '').trim();
  try { return JSON.parse(raw); } catch (_) {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch (_) {}
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch (_) {}
  }
  throw new Error('Fallback solver returned invalid JSON.');
}

function buildPrompt(problem) {
  const tableSections = (problem.tables || []).map((table, i) => {
    const headers = (table.headers || []).join(' | ');
    const rows = (table.rows || []).map(row => row.map(cell => cell?.text ?? '').join(' | ')).join('\n');
    return `TABLE ${i + 1}:\n${headers}\n${rows}`;
  }).join('\n\n');

  const graphSections = (problem.graphs || []).map((g, i) => {
    const bits = [`GRAPH ${i + 1}:`];
    if (g.dataScript) bits.push(`data-script:\n${g.dataScript}`);
    if (g.labels) bits.push(`labels:\n${g.labels}`);
    return bits.join('\n');
  }).join('\n\n');

  return [
    'Solve the problem. Return only compact JSON with keys steps, answer, entry, confidence.',
    'steps must be a short array of student-friendly steps. entry must be MyOpenMath plain input syntax.',
    `QUESTION:\n${problem.text || ''}`,
    tableSections,
    graphSections
  ].filter(Boolean).join('\n\n');
}

async function solveWithOllama(problem) {
  const { endpoint, model } = await getSettings();
  const response = await fetch(`${endpoint}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      format: 'json',
      keep_alive: '10m',
      options: { temperature: 0, num_predict: 500 },
      messages: [
        { role: 'system', content: 'You are a concise math solver. Use exact arithmetic. Output JSON only.' },
        { role: 'user', content: buildPrompt(problem) }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`AI fallback returned HTTP ${response.status}${body ? `: ${body.slice(0, 160)}` : ''}`);
  }

  const data = await response.json();
  const parsed = extractJson(data?.message?.content || '');
  const steps = Array.isArray(parsed.steps) ? parsed.steps.map(String).filter(Boolean) : [];
  const answer = String(parsed.answer ?? '').trim();
  const entry = String(parsed.entry ?? answer).trim();
  const confidence = ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'medium';
  if (!steps.length || !entry) throw new Error('AI fallback did not return usable steps and an answer.');
  return { ok: true, engine: 'ai-fallback', steps, answer, entry, confidence, model };
}

async function solveProblem(problem) {
  const deterministic = self.MOMCalculator?.solve(problem || {});
  if (deterministic?.ok) {
    const hasTeachingSteps = Array.isArray(deterministic?.solution?.steps) && deterministic.solution.steps.length > 0;
    if (!hasTeachingSteps) throw new Error('The calculator found an answer but did not produce teaching steps, so it was not autofilled.');
    return deterministic;
  }

  const settings = await getSettings();
  if (!settings.aiFallback) {
    throw new Error('Fast calculator does not recognize this problem yet. Enable AI fallback in settings for unsupported problem types.');
  }
  return solveWithOllama(problem || {});
}

async function testOllama() {
  const { endpoint, model } = await getSettings();
  const response = await fetch(`${endpoint}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      format: 'json',
      options: { temperature: 0, num_predict: 30 },
      messages: [{ role: 'user', content: 'Return only {"ok":true}.' }]
    })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { ok: true, endpoint, model };
}

async function findMyOpenMathFrame(tabId) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  if (!frames) return null;
  const matches = frames.filter(frame => {
    try { return new URL(frame.url).hostname === 'www.myopenmath.com'; }
    catch (_) { return false; }
  });
  if (!matches.length) return null;
  matches.sort((a, b) => Number(b.url.includes('/assess2/')) - Number(a.url.includes('/assess2/')));
  return matches[0];
}

function sendToFrame(tabId, frameId, message) {
  return chrome.tabs.sendMessage(tabId, message, { frameId });
}

async function saveLastSolve(payload) {
  await chrome.storage.session.set({ momLastSolve: payload });
}

async function getLastSolve(tabId) {
  const { momLastSolve } = await chrome.storage.session.get('momLastSolve');
  if (!momLastSolve || momLastSolve.tabId !== tabId) return null;
  return momLastSolve;
}

async function setShortcutBadge(tabId, text, title) {
  await chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  await chrome.action.setTitle({ tabId, title }).catch(() => {});
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    chrome.action.setTitle({ tabId, title: 'MOM Helper' }).catch(() => {});
  }, 2500);
}

async function solveActiveQuestionFromShortcut() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab.');
  const tabId = tab.id;
  const frame = await findMyOpenMathFrame(tabId);
  if (!frame) throw new Error('No MyOpenMath question found in this tab.');

  const state = await sendToFrame(tabId, frame.frameId, { target: 'mom-helper-content', type: 'get-state' });
  if (!state?.ok || !state.question?.text) throw new Error(state?.error || 'Could not read the current question.');

  await setShortcutBadge(tabId, '…', 'MOM Helper — solving');
  const result = await solveProblem(state.question);
  const filled = await sendToFrame(tabId, frame.frameId, {
    target: 'mom-helper-content',
    type: 'fill-solution',
    questionId: state.question.id || null,
    expectedQuestion: {id:state.question.id||null,text:state.question.text||'',answerIds:(state.question.answers||[]).map(a=>a.id)},
    solution: result
  });

  if (!filled?.ok) throw new Error(filled?.error || 'Solved, but could not fill the answer.');

  await saveLastSolve({
    tabId,
    frameId: frame.frameId,
    questionId: state.question.id || null,
    questionText: state.question.text || '',
    result,
    filled,
    timestamp: Date.now()
  });
  await setShortcutBadge(tabId, '✓', `Solved: ${result.answer || result.entry || 'done'}`);
  return { ok: true, result, filled, questionId: state.question.id || null };
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'solve-current-question') return;
  solveActiveQuestionFromShortcut().catch(async (error) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    if (tab?.id) {
      await saveLastSolve({ tabId: tab.id, error: error?.message || String(error), timestamp: Date.now() }).catch(() => {});
      await setShortcutBadge(tab.id, '!', `MOM Helper: ${error?.message || String(error)}`);
    }
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== 'mom-helper-background') return;

  if (message.type === 'capture-question') {
    putCapture(message.snapshot || {})
      .then(sendResponse)
      .catch(error => sendResponse({ ok:false, error:error?.message || String(error) }));
    return true;
  }

  if (message.type === 'capture-count') {
    captureCount().then(count => sendResponse({ok:true,count})).catch(error=>sendResponse({ok:false,error:error?.message||String(error)}));
    return true;
  }

  if (message.type === 'capture-list') {
    listCaptures().then(records => sendResponse({ok:true,records})).catch(error=>sendResponse({ok:false,error:error?.message||String(error)}));
    return true;
  }

  if (message.type === 'capture-clear') {
    clearCaptures().then(sendResponse).catch(error=>sendResponse({ok:false,error:error?.message||String(error)}));
    return true;
  }

  if (message.type === 'solve') {
    solveProblem(message.problem || {})
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message.type === 'test-solver') {
    testOllama()
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message.type === 'get-last-solve') {
    getLastSolve(message.tabId)
      .then(last => sendResponse({ ok: true, last }))
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
});
