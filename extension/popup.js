const $ = (id) => document.getElementById(id);

const statusEl = $('status');
const substatusEl = $('substatus');
const emptyEl = $('empty');
const contentEl = $('content');
const questionEl = $('question');
const questionPickerWrapEl = $('questionPickerWrap');
const questionPickerEl = $('questionPicker');
const stepsEl = $('steps');
const stepsTitleEl = $('stepsTitle');
const answerEl = $('answer');
const engineEl = $('engine');
const fillStatusEl = $('fillStatus');
const busyEl = $('busy');
const devEl = $('dev');
const refreshBtn = $('refresh');
const solveBtn = $('solve');
const endpointEl = $('endpoint');
const modelEl = $('model');
const aiFallbackEl = $('aiFallback');
const aiFieldsEl = $('aiFields');
const saveSettingsBtn = $('saveSettings');
const testSolverBtn = $('testSolver');
const solverStatusEl = $('solverStatus');
const captureEnabledEl = $('captureEnabled');
const captureCountEl = $('captureCount');
const captureCurrentBtn = $('captureCurrent');
const captureAllBtn = $('captureAll');
const exportDatasetBtn = $('exportDataset');
const clearDatasetBtn = $('clearDataset');
const captureStatusEl = $('captureStatus');

let activeTabId = null;
let myOpenMathFrameId = null;
let currentQuestion = null;
let currentQuestions = [];
let currentState = null;

function showEmpty(message) {
  contentEl.classList.add('hidden');
  emptyEl.classList.remove('hidden');
  emptyEl.textContent = message;
}
function showContent() { emptyEl.classList.add('hidden'); contentEl.classList.remove('hidden'); }
function setStatus(main, sub = '') { statusEl.textContent = main; substatusEl.textContent = sub; }
function resetSolution() {
  stepsEl.innerHTML = '';
  stepsEl.classList.add('hidden');
  stepsTitleEl.classList.add('hidden');
  answerEl.textContent = '';
  answerEl.classList.add('hidden');
  engineEl.textContent = '';
  engineEl.classList.add('hidden');
  fillStatusEl.textContent = '';
  fillStatusEl.classList.add('hidden');
}

function renderQuestionDiagnostics(q, state) {
  const answers = q.answers || [];
  devEl.textContent = [
    `Question: ${q.id || '(none)'}`,
    `Problems detected: ${currentQuestions.length}`,
    `Answer fields: ${answers.map(a => `${a.id || a.name || '(unnamed)'} [${a.kind || a.dataMq || a.type || a.tag}]`).join(', ') || '(none)'}`,
    `Tables: ${(q.tables || []).length}`,
    `Graphs: ${(q.graphs || []).length}`,
    `Widgets: ${Object.entries(q.widgets || {}).filter(([,v])=>v).map(([k])=>k).join(', ') || 'none'}`,
    `Graph data-script: ${(q.graphs || []).some(g => g.dataScript) ? 'yes' : 'no'}`,
    `MathQuill: ${state?.bridge?.hasMathQuill ? 'yes' : 'no'}`,
    `Frame: ${state?.frameUrl || ''}`
  ].join('\n');
}

function chooseQuestion(index, {restore=true}={}) {
  const safe = Math.max(0, Math.min(Number(index)||0, currentQuestions.length-1));
  currentQuestion = currentQuestions[safe] || null;
  questionPickerEl.value = String(safe);
  resetSolution();
  if (!currentQuestion) return;
  questionEl.textContent = currentQuestion.text || '(No readable question text found)';
  solveBtn.disabled = !currentQuestion.text;
  setStatus(currentQuestion.pageLabel || currentQuestion.id || 'Question detected', currentQuestions.length > 1 ? `${safe+1} of ${currentQuestions.length} problems detected` : 'MyOpenMath connected');
  renderQuestionDiagnostics(currentQuestion, currentState);
  if (restore) restoreLastShortcutSolve();
}

function updateFallbackVisibility() {
  aiFieldsEl.classList.toggle('disabled-fields', !aiFallbackEl.checked);
}

async function refreshCaptureCount() {
  const result = await chrome.runtime.sendMessage({target:'mom-helper-background', type:'capture-count'});
  const count = result?.ok ? Number(result.count || 0) : 0;
  captureCountEl.textContent = `${count} unique question${count === 1 ? '' : 's'} saved`;
  return count;
}

async function loadCaptureSettings() {
  const stored = await chrome.storage.local.get('captureEnabled');
  captureEnabledEl.checked = stored.captureEnabled === true;
  await refreshCaptureCount();
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1500);
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(['solverEndpoint', 'solverModel', 'aiFallback']);
  endpointEl.value = stored.solverEndpoint || 'http://127.0.0.1:11434';
  modelEl.value = stored.solverModel || 'qwen3.5:9b';
  aiFallbackEl.checked = stored.aiFallback === true;
  updateFallbackVisibility();
}

async function saveSettings() {
  const endpoint = endpointEl.value.trim().replace(/\/+$/, '') || 'http://127.0.0.1:11434';
  const model = modelEl.value.trim() || 'qwen3.5:9b';
  const aiFallback = aiFallbackEl.checked;
  await chrome.storage.local.set({ solverEndpoint: endpoint, solverModel: model, aiFallback });
  endpointEl.value = endpoint;
  modelEl.value = model;
  solverStatusEl.textContent = aiFallback ? 'Saved. Calculator first, AI only as fallback.' : 'Saved. Calculator-only mode.';
  updateFallbackVisibility();
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

function sendToFrame(message) {
  if (activeTabId == null || myOpenMathFrameId == null) throw new Error('MyOpenMath frame is not connected.');
  return chrome.tabs.sendMessage(activeTabId, message, { frameId: myOpenMathFrameId });
}

async function loadState() {
  setStatus('Looking for MyOpenMath…');
  resetSolution();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { showEmpty('Could not identify the active tab.'); setStatus('Not connected'); return; }
  activeTabId = tab.id;
  const frame = await findMyOpenMathFrame(tab.id);
  if (!frame) {
    myOpenMathFrameId = null; currentQuestion = null; currentQuestions = []; currentState = null;
    setStatus('No MyOpenMath page detected');
    showEmpty('Open a MyOpenMath homework problem in this tab, then click the extension again.');
    return;
  }
  myOpenMathFrameId = frame.frameId;
  setStatus('Connecting…', 'MyOpenMath frame found');

  let state;
  try { state = await sendToFrame({ target: 'mom-helper-content', type: 'get-state' }); }
  catch (_) {
    setStatus('Reload MyOpenMath once');
    showEmpty('Reload the Canvas/MyOpenMath page once, then open the extension again.');
    return;
  }
  if (!state?.ok) { setStatus('Connection failed'); showEmpty(state?.error || 'Could not read the problem.'); return; }

  showContent();
  currentState = state;
  if (!state.hasQuestion || !state.question) {
    currentQuestion = null; currentQuestions = []; questionPickerWrapEl.classList.add('hidden'); setStatus('MyOpenMath connected'); questionEl.textContent = ''; solveBtn.disabled = true;
    devEl.textContent = `Frame: ${state.frameUrl || ''}`; return;
  }

  currentQuestions = Array.isArray(state.questions) && state.questions.length ? state.questions : [state.question];
  questionPickerEl.replaceChildren(...currentQuestions.map((q,index)=>{
    const option=document.createElement('option');
    option.value=String(index);
    const preview=String(q.text||'').replace(/\s+/g,' ').slice(0,70);
    option.textContent=`${q.pageLabel || `Question ${index+1}`} — ${preview || 'No readable prompt'}`;
    return option;
  }));
  questionPickerWrapEl.classList.toggle('hidden',currentQuestions.length<2);
  const activeIndex=Math.max(0,currentQuestions.findIndex(q=>q.id===state.activeQuestionId));
  chooseQuestion(activeIndex,{restore:false});
  await restoreLastShortcutSolve();
}

function renderSolution(result, fillMessage = '') {
  resetSolution();
  const structuredSteps = Array.isArray(result?.solution?.steps) ? result.solution.steps : null;
  if (structuredSteps?.length) {
    for (const step of structuredSteps) {
      const li = document.createElement('li');
      li.className = 'rich-step';
      const label = document.createElement('div');
      label.className = 'step-label';
      MOMMath.renderExplanation(label, step.explanation || '');
      li.appendChild(label);
      for (const formula of step.math || []) {
        const mathLine = document.createElement('div');
        mathLine.className = 'math-line';
        if(MOMMath.renderFormula(mathLine, formula, true).getAttribute('data-mom-fallback')==='true')mathLine.classList.add('math-line-fallback');
        li.appendChild(mathLine);
      }
      stepsEl.appendChild(li);
    }
  } else {
  const richSteps = Array.isArray(result?.richSteps) ? result.richSteps : null;
  if (richSteps?.length) {
    for (const step of richSteps) {
      const li = document.createElement('li');
      li.className = 'rich-step';
      if (step.label) {
        const label = document.createElement('div');
        label.className = 'step-label';
        MOMMath.renderExplanation(label, step.label);
        li.appendChild(label);
      }
      for (const formula of step.formulas || []) {
        const mathLine = document.createElement('div');
        mathLine.className = 'math-line';
        if(MOMMath.renderFormula(mathLine, formula, true).getAttribute('data-mom-fallback')==='true')mathLine.classList.add('math-line-fallback');
        li.appendChild(mathLine);
      }
      stepsEl.appendChild(li);
    }
  } else {
    for (const step of result?.steps || []) {
      const li = document.createElement('li');
      MOMMath.renderExplanation(li, step);
      stepsEl.appendChild(li);
    }
  }
  }
  stepsEl.classList.remove('hidden');
  stepsTitleEl.classList.remove('hidden');

  answerEl.replaceChildren();
  const answerLabel = document.createElement('div');
  answerLabel.className = 'answer-label';
  answerLabel.textContent = 'Answer';
  answerEl.appendChild(answerLabel);
  const mixedChoiceAndEntry=Array.isArray(result?.selections)&&Array.isArray(result?.entries)&&result.entries.length;
  const answerParts = mixedChoiceAndEntry ? [result?.answerMath || result?.answer, ...result.entries]
    : Array.isArray(result?.entries) && result.entries.length > 1
    ? result.entries : [result?.answerMath || result?.answer || result?.entry];
  for (let i=0;i<answerParts.length;i++) {
    const answerMath = document.createElement('div');
    answerMath.className = 'answer-math';
    if(answerParts.length>1) {
      const partLabel=document.createElement('div');
      partLabel.className='answer-part-label';
      partLabel.textContent=mixedChoiceAndEntry?(i===0?'Choice':'A'): `Part ${i+1}`;
      answerEl.appendChild(partLabel);
    }
    if(String(currentQuestion?.answers?.[i]?.tag||'').toLowerCase()==='textarea') {
      answerMath.classList.add('answer-prose');
      answerMath.textContent=String(answerParts[i]);
    } else if(MOMMath.renderFormula(answerMath, answerParts[i], true).getAttribute('data-mom-fallback')==='true')answerMath.classList.add('answer-prose');
    answerEl.appendChild(answerMath);
  }
  answerEl.classList.remove('hidden');
  const engineLabels={calculator:'Deterministic calculator',calculus:'Deterministic calculus engine',course:'Deterministic course engine','ai-fallback':'Local AI fallback'};
  engineEl.textContent = engineLabels[result?.engine] || 'Deterministic calculator';
  engineEl.classList.remove('hidden');

  if (fillMessage) {
    fillStatusEl.textContent = fillMessage;
    fillStatusEl.classList.remove('hidden');
  }
}

async function restoreLastShortcutSolve() {
  if (activeTabId == null || !currentQuestion) return;
  try {
    const response = await chrome.runtime.sendMessage({
      target: 'mom-helper-background',
      type: 'get-last-solve',
      tabId: activeTabId
    });
    const last = response?.last;
    if (!last) return;
    if (last.error) {
      if (Date.now() - Number(last.timestamp || 0) < 15000) {
        fillStatusEl.textContent = last.error;
        fillStatusEl.classList.remove('hidden');
      }
      return;
    }
    if (last.questionId && last.questionId !== currentQuestion.id) return;
    if (!last.result?.ok) return;
    renderSolution(last.result, `Filled by shortcut: ${last.filled?.hiddenValue || last.result.entry}`);
  } catch (_) {}
}

async function solveCurrent() {
  if (!currentQuestion) return;
  const selectedId=currentQuestion.id;
  const selectedIndex=currentQuestions.findIndex(q=>q.id===selectedId);
  solveBtn.disabled = true;
  busyEl.classList.remove('hidden');
  resetSolution();
  try {
    // MyOpenMath replaces question markup when a similar question or another
    // attempt loads. Refresh immediately before solving so the first click
    // cannot use the popup's older snapshot.
    const liveState=await sendToFrame({target:'mom-helper-content',type:'get-state'});
    if(!liveState?.ok)throw new Error(liveState?.error||'Could not refresh the current problem.');
    const liveQuestions=Array.isArray(liveState.questions)?liveState.questions:[];
    const selectedQuestion=liveQuestions.find(q=>q.id===selectedId)||liveQuestions[selectedIndex]||liveState.question;
    if(!selectedQuestion?.text)throw new Error('The selected problem is no longer available. Refresh the popup and try again.');
    currentQuestion=selectedQuestion;
    const result = await chrome.runtime.sendMessage({ target: 'mom-helper-background', type: 'solve', problem: selectedQuestion });
    if (!result?.ok) throw new Error(result?.error || 'Solver failed.');

    const filled = await sendToFrame({ target: 'mom-helper-content', type: 'fill-solution', questionId: selectedQuestion.id, expectedQuestion:{id:selectedQuestion.id,text:selectedQuestion.text,answerIds:(selectedQuestion.answers||[]).map(a=>a.id)}, solution: result });
    if(currentQuestion?.id!==selectedQuestion.id)return;
    const fillMessage = filled?.ok
      ? `Filled: ${filled.hiddenValue || result.answer || result.entry || 'done'}`
      : `Solved, but could not fill: ${filled?.error || 'unknown error'}`;
    renderSolution(result, fillMessage);
  } catch (error) {
    fillStatusEl.textContent = error?.message || String(error);
    fillStatusEl.classList.remove('hidden');
  } finally {
    busyEl.classList.add('hidden');
    solveBtn.disabled = false;
  }
}

refreshBtn.addEventListener('click', () => loadState().catch(error => showEmpty(error?.message || String(error))));
solveBtn.addEventListener('click', solveCurrent);
questionPickerEl.addEventListener('change', () => chooseQuestion(Number(questionPickerEl.value)));
aiFallbackEl.addEventListener('change', () => saveSettings().catch(error => { solverStatusEl.textContent = error?.message || String(error); }));
saveSettingsBtn.addEventListener('click', () => saveSettings().catch(error => { solverStatusEl.textContent = error?.message || String(error); }));
testSolverBtn.addEventListener('click', async () => {
  solverStatusEl.textContent = 'Checking real POST request…';
  try {
    await saveSettings();
    const result = await chrome.runtime.sendMessage({ target: 'mom-helper-background', type: 'test-solver' });
    if (!result?.ok) throw new Error(result?.error || 'Connection failed.');
    solverStatusEl.textContent = `Fallback connected: ${result.model}.`;
  } catch (error) {
    solverStatusEl.textContent = `Fallback unavailable: ${error?.message || String(error)}`;
  }
});

captureEnabledEl.addEventListener('change', async () => {
  await chrome.storage.local.set({captureEnabled:captureEnabledEl.checked});
  captureStatusEl.textContent = captureEnabledEl.checked ? 'Recording new question shapes locally.' : 'Automatic recording is off.';
  if (captureEnabledEl.checked && currentQuestion) {
    try { await sendToFrame({target:'mom-helper-content',type:'capture-current',questionId:currentQuestion.id}); } catch (_) {}
    await refreshCaptureCount();
  }
});

captureCurrentBtn.addEventListener('click', async () => {
  captureStatusEl.textContent = 'Capturing current question…';
  try {
    const result = await sendToFrame({target:'mom-helper-content',type:'capture-current',questionId:currentQuestion?.id||null});
    if (!result?.ok && !result?.deduplicated) throw new Error(result?.error || 'Capture failed.');
    captureStatusEl.textContent = result?.deduplicated ? 'Already saved; sighting count updated.' : 'Question saved.';
    await refreshCaptureCount();
  } catch (error) { captureStatusEl.textContent = error?.message || String(error); }
});

captureAllBtn.addEventListener('click', async () => {
  captureAllBtn.disabled=true;
  captureStatusEl.textContent='Capturing all problems on this page…';
  try{
    const result=await sendToFrame({target:'mom-helper-content',type:'capture-all'});
    if(!result?.ok)throw new Error(result?.error||'Capture failed.');
    captureStatusEl.textContent=`Captured ${result.saved} of ${result.total} problems${result.skipped?`; ${result.skipped} were not ready`:''}.`;
    await refreshCaptureCount();
  }catch(error){captureStatusEl.textContent=error?.message||String(error);}
  finally{captureAllBtn.disabled=false;}
});

exportDatasetBtn.addEventListener('click', async () => {
  captureStatusEl.textContent = 'Preparing export…';
  try {
    const result = await chrome.runtime.sendMessage({target:'mom-helper-background',type:'capture-list'});
    if (!result?.ok) throw new Error(result?.error || 'Could not read dataset.');
    const records = result.records || [];
    downloadJson(`mom-helper-question-corpus-${new Date().toISOString().slice(0,10)}.json`, {
      schema:'mom-helper-question-corpus', schemaVersion:1, exportedAt:new Date().toISOString(), count:records.length, records
    });
    captureStatusEl.textContent = `Exported ${records.length} unique questions.`;
  } catch (error) { captureStatusEl.textContent = error?.message || String(error); }
});

clearDatasetBtn.addEventListener('click', async () => {
  if (!confirm('Clear the locally recorded question dataset?')) return;
  const result = await chrome.runtime.sendMessage({target:'mom-helper-background',type:'capture-clear'});
  captureStatusEl.textContent = result?.ok ? 'Dataset cleared.' : (result?.error || 'Could not clear dataset.');
  await refreshCaptureCount();
});

Promise.all([loadSettings(), loadCaptureSettings(), loadState()]).catch(error => { setStatus('Error'); showEmpty(error?.message || String(error)); });
