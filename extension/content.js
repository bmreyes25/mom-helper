(() => {
  if (window.__MOM_HELPER_CONTENT__) return;
  window.__MOM_HELPER_CONTENT__ = true;

  function injectBridge() {
    if (document.documentElement.dataset.momHelperBridgeInjected === '1') return;
    document.documentElement.dataset.momHelperBridgeInjected = '1';
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('page-bridge.js');
    script.async = false;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }
  injectBridge();

  let lastClickedQuestion = null;
  let requestCounter = 0;
  const pending = new Map();

  function bridgeRequest(type, payload = {}) {
    return new Promise((resolve, reject) => {
      const requestId = `mom-${Date.now()}-${++requestCounter}`;
      const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error('Page bridge timed out.')); }, 3000);
      pending.set(requestId, { resolve, reject, timeout });
      window.postMessage({ source: 'mom-helper-content', requestId, type, ...payload }, '*');
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== 'mom-helper-page' || !msg.requestId) return;
    const entry = pending.get(msg.requestId);
    if (!entry) return;
    clearTimeout(entry.timeout); pending.delete(msg.requestId); entry.resolve(msg);
  });

  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  }
  function scoreQuestion(el) {
    const r = el.getBoundingClientRect();
    const top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom);
    return Math.max(0, bottom - top) / Math.max(1, Math.min(r.height, innerHeight));
  }
  function findActiveQuestion() {
    if (lastClickedQuestion && document.contains(lastClickedQuestion) && isVisible(lastClickedQuestion)) return lastClickedQuestion;
    const all = [...document.querySelectorAll('[id^="questionwrap"], .questionwrap')].filter(isVisible);
    if (!all.length) return null;
    all.sort((a,b) => scoreQuestion(b)-scoreQuestion(a));
    return all[0];
  }
  function findPageQuestions() {
    const candidates = [...document.querySelectorAll('[id^="questionwrap"], .questionwrap')];
    const rendered = candidates.filter(el => {
      const style = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    });
    // Some themes put a .questionwrap inside an id-based question wrapper.
    // Retain only the outermost matching element so one problem is never
    // advertised twice in the popup.
    return rendered.filter(el => !rendered.some(other => other !== el && other.contains(el)));
  }

  function normalizeText(text) {
    return String(text || '').replace(/\u200B/g,' ').replace(/\u2212/g,'-').replace(/\u2192/g,'->').replace(/\u221e/g,'oo')
      .replace(/[ \t]+/g,' ').replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  }

  function texToSemanticText(tex) {
    let out = String(tex || '').trim();
    if (!out) return '';
    // Convert the most common TeX emitted by MathJax into a compact textual
    // form that the deterministic parser can understand while preserving the
    // mathematical meaning needed for limits, function values, and choices.
    out = out
      .replace(/\\left|\\right/g, '')
      .replace(/\\(?:,|!|;|:|quad|qquad)/g, ' ')
      .replace(/\\(?:to|rightarrow|longrightarrow)\b/g, '->')
      .replace(/\\infty\b/g, 'oo')
      .replace(/\\lim\b/g, 'lim')
      .replace(/\\(?:operatorname|mathrm|text)\s*\{([^{}]*)\}/g, '$1')
      .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
      .replace(/_\s*\{/g, '_(')
      .replace(/\^\s*\{/g, '^(')
      .replace(/\{/g, '(')
      .replace(/\}/g, ')')
      .replace(/\\([A-Za-z]+)/g, '$1')
      .replace(/~/g, ' ');
    // Close groups opened by _{ and ^{ after the general brace conversion.
    // The exact grouping is less important than retaining targets like x->2.
    return normalizeText(out);
  }

  function mathMLToText(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return normalizeText(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.localName?.toLowerCase();
    const kids = [...node.childNodes].map(mathMLToText).filter(Boolean);
    const join = () => kids.join(' ').replace(/\s+/g,' ').trim();
    if (['mi','mn','mtext','mo'].includes(tag)) return normalizeText(node.textContent);
    if (tag === 'mfrac') return `(${kids[0] || ''})/(${kids[1] || ''})`;
    if (tag === 'msup') return `${kids[0] || ''}^(${kids[1] || ''})`;
    if (tag === 'msub') return `${kids[0] || ''}_${kids[1] || ''}`;
    if (tag === 'msubsup') return `${kids[0] || ''}_${kids[1] || ''}^(${kids[2] || ''})`;
    if (tag === 'msqrt') return `sqrt(${join()})`;
    if (tag === 'mroot') return `root(${kids[0] || ''},${kids[1] || ''})`;
    if (tag === 'munder') return `${kids[0] || ''}_(${kids[1] || ''})`;
    if (tag === 'mover') return `${kids[0] || ''}^(${kids[1] || ''})`;
    if (tag === 'munderover') return `${kids[0] || ''}_(${kids[1] || ''})^(${kids[2] || ''})`;
    return join();
  }

  function extractMathSource(el) {
    if (!el) return '';
    const texAnn = el.querySelector?.('annotation[encoding*="tex" i], annotation[encoding*="latex" i]');
    if (texAnn?.textContent?.trim()) return texToSemanticText(texAnn.textContent);
    const attrs = ['data-mom-tex','data-tex','data-latex','data-asciimath','alttext','aria-label','title'];
    for (const a of attrs) {
      const v = el.getAttribute?.(a);
      if (v && v.trim() && !/^Question\s+\d+/i.test(v.trim())) {
        return /^data-(?:mom-tex|tex|latex)$/i.test(a) ? texToSemanticText(v) : normalizeText(v);
      }
    }
    const math = el.localName?.toLowerCase() === 'math' ? el : el.querySelector?.('math');
    if (math) {
      const t = mathMLToText(math);
      if (t) return normalizeText(t);
    }
    const assist = el.querySelector?.('mjx-assistive-mml');
    if (assist) {
      const t = mathMLToText(assist.querySelector('math') || assist);
      if (t) return normalizeText(t);
    }
    // Last-resort fallback for renderers that leave textual glyph content in
    // the output node.  Avoid generic container labels.
    const plain = normalizeText(el.textContent || '');
    if (plain && plain.length < 500) return plain;
    return '';
  }


  function semanticClone(source) {
    const clone = source.cloneNode(true);
    const candidates = [...clone.querySelectorAll('mjx-container, math, .MathJax, .MathJax_SVG, .MathJax_CHTML, img')];
    for (const el of candidates) {
      if (el.closest('mjx-container, math, .MathJax, .MathJax_SVG, .MathJax_CHTML') !== el && el.localName !== 'img') continue;
      const src = extractMathSource(el) || (el.localName === 'img' ? normalizeText(el.getAttribute('alt') || '') : '');
      if (src) el.replaceWith(document.createTextNode(` ${src} `));
    }
    for (const script of [...clone.querySelectorAll('script[type^="math/tex"], script[type*="mathml"]')]) {
      const src = normalizeText(script.textContent);
      if (src) script.replaceWith(document.createTextNode(` ${src} `));
    }
    return clone;
  }

  function semanticText(source, { removeTables = false, removeAnswers = false } = {}) {
    if (!source) return '';
    const clone = semanticClone(source);
    const selectors = ['script:not([type^="math/tex"])','style','noscript','svg','embed','object','canvas','button','.submitbtnwrap','.mq-textarea','.mq-aria-alert','[id^="mqinput-"]','[id^="tips"]','.sr-only','.sr-only-focusable'];
    if (removeTables) selectors.push('table');
    if (removeAnswers) {
      // Remove whole choice labels before removing the controls themselves so
      // True/False and multiple-choice options do not get appended to the prompt.
      clone.querySelectorAll('label').forEach(label => {
        if (label.querySelector('input[id^=\"qn\"], textarea[id^=\"qn\"], select[id^=\"qn\"], input[name^=\"qn\"], textarea[name^=\"qn\"], select[name^=\"qn\"]')) label.remove();
      });
      selectors.push('input','textarea','select');
    }
    clone.querySelectorAll(selectors.join(',')).forEach(n => n.remove());
    return normalizeText(clone.innerText || clone.textContent || '');
  }

  function getPromptRoot(questionWrap) {
    return questionWrap.querySelector(':scope > .question') || questionWrap.querySelector('.question.qscope, .question[role="region"], .question') || questionWrap;
  }

  function cleanQuestionText(questionWrap) {
    const source = getPromptRoot(questionWrap);
    return semanticText(source, { removeTables: true, removeAnswers: true });
  }

  function numAttr(el, name, fallback = null) {
    const v = Number(el.getAttribute(name));
    return Number.isFinite(v) ? v : fallback;
  }

  function extractGraph(svg, index) {
    const textLabels = [...svg.querySelectorAll('text')].map(n => normalizeText(n.textContent)).filter(Boolean).join(' ');
    const width = numAttr(svg,'width', svg.viewBox?.baseVal?.width || 400);
    const height = numAttr(svg,'height', svg.viewBox?.baseVal?.height || 400);
    const xmin = numAttr(svg,'xmin',null), xmax = numAttr(svg,'xmax',null), ymin = numAttr(svg,'ymin',null), ymax = numAttr(svg,'ymax',null);
    const xunit = numAttr(svg,'xunitlength', (xmin != null && xmax != null ? width/(xmax-xmin) : null));
    const yunit = numAttr(svg,'yunitlength', (ymin != null && ymax != null ? height/(ymax-ymin) : null));
    const ox = numAttr(svg,'ox', (xmin != null && xunit ? -xmin*xunit : width/2));
    const oy = numAttr(svg,'oy', (ymax != null && yunit ? ymax*yunit : height/2));
    const points = [];
    if (xunit && yunit) {
      for (const c of svg.querySelectorAll('circle')) {
        const cx = numAttr(c,'cx'), cy = numAttr(c,'cy'), r = numAttr(c,'r',0);
        if (cx == null || cy == null || r < 1.5 || r > 12) continue;
        const x = (cx-ox)/xunit, y = (oy-cy)/yunit;
        if (![x,y].every(Number.isFinite)) continue;
        if (xmin != null && (x < xmin-.25 || x > xmax+.25)) continue;
        if (ymin != null && (y < ymin-.25 || y > ymax+.25)) continue;
        const fill = String(c.getAttribute('fill') || '').toLowerCase();
        const cls = String(c.getAttribute('class') || '').toLowerCase();
        const open = fill === 'white' || fill === 'none' || fill === 'transparent' || cls.includes('open');
        points.push({ x, y, open, closed: !open, fill, r });
      }
    }
    const segments = [];
    const toGraph = (px, py) => {
      if (!xunit || !yunit) return null;
      const x = (px - ox) / xunit, y = (oy - py) / yunit;
      if (![x,y].every(Number.isFinite)) return null;
      if (xmin != null && (x < xmin-.5 || x > xmax+.5)) return null;
      if (ymin != null && (y < ymin-.5 || y > ymax+.5)) return null;
      return [x,y];
    };
    const addSegment = (el, raw) => {
      const pts = raw.map(p => toGraph(p[0],p[1])).filter(Boolean);
      if (pts.length < 2) return;
      // Remove consecutive duplicates from SVG sampling.
      const clean = [];
      for (const pt of pts) {
        const prev = clean[clean.length-1];
        if (!prev || Math.hypot(pt[0]-prev[0],pt[1]-prev[1]) > 1e-5) clean.push(pt);
      }
      if (clean.length < 2) return;
      segments.push({
        points: clean,
        stroke: String(el.getAttribute('stroke') || getComputedStyle(el).stroke || ''),
        fill: String(el.getAttribute('fill') || getComputedStyle(el).fill || ''),
        strokeWidth: String(el.getAttribute('stroke-width') || getComputedStyle(el).strokeWidth || ''),
        id: el.id || null,
        className: el.getAttribute('class') || ''
      });
    };
    if (xunit && yunit) {
      for (const path of svg.querySelectorAll('path')) {
        try {
          const len = path.getTotalLength?.();
          if (!Number.isFinite(len) || len < 2) continue;
          const count = Math.max(8, Math.min(140, Math.ceil(len / 6)));
          const raw = [];
          for (let i=0;i<=count;i++) {
            const pt = path.getPointAtLength(len * i / count);
            raw.push([pt.x,pt.y]);
          }
          addSegment(path, raw);
        } catch (_) {}
      }
      for (const line of svg.querySelectorAll('line')) {
        const x1=numAttr(line,'x1'), y1=numAttr(line,'y1'), x2=numAttr(line,'x2'), y2=numAttr(line,'y2');
        if ([x1,y1,x2,y2].every(Number.isFinite)) addSegment(line, [[x1,y1],[x2,y2]]);
      }
      for (const poly of svg.querySelectorAll('polyline')) {
        const raw = String(poly.getAttribute('points') || '').trim().split(/\s+/).map(pair=>pair.split(',').map(Number)).filter(p=>p.length===2&&p.every(Number.isFinite));
        if (raw.length >= 2) addSegment(poly, raw);
      }
    }

    return {
      index, id: svg.id || null, width: svg.getAttribute('width'), height: svg.getAttribute('height'), viewBox: svg.getAttribute('viewBox'),
      xmin: svg.getAttribute('xmin'), xmax: svg.getAttribute('xmax'), ymin: svg.getAttribute('ymin'), ymax: svg.getAttribute('ymax'),
      xunitlength: svg.getAttribute('xunitlength'), yunitlength: svg.getAttribute('yunitlength'), ox: svg.getAttribute('ox'), oy: svg.getAttribute('oy'),
      // Before ASCIIsvg finishes rendering, MyOpenMath exposes an <embed>
      // whose `script` attribute contains the same graph model later copied to
      // the rendered SVG's `data-script` attribute.
      dataScript: (svg.getAttribute('data-script') || svg.getAttribute('script') || '').slice(0, 40000), labels: textLabels.slice(0,5000), points, segments
    };
  }

  function parseNumericCell(text) {
    const cleaned = normalizeText(text).replace(/[$,%]/g,'').replace(/,/g,'');
    if (!/^[-+]?\d+(?:\.\d+)?$/.test(cleaned)) return null;
    const value = Number(cleaned); return Number.isFinite(value) ? value : null;
  }

  function extractTables(promptRoot) {
    const tables = [];
    for (const table of promptRoot.querySelectorAll('table')) {
      const domRows = [...table.querySelectorAll('tr')];
      if (domRows.length < 2) continue;
      const rawRows = domRows.map(tr => [...tr.querySelectorAll(':scope > th, :scope > td')].map(cell => semanticText(cell))).filter(r => r.length >= 2);
      if (rawRows.length < 2) continue;
      const first = rawRows[0];
      const firstHasHeaderCell = !!table.querySelector('tr:first-child th');
      const firstLooksLikeHeader = firstHasHeaderCell || first.some(cell => parseNumericCell(cell) == null);
      const headers = firstLooksLikeHeader ? first : first.map((_,i)=>`Column ${i+1}`);
      const dataDomRows = firstLooksLikeHeader ? domRows.slice(1) : domRows;
      const rows = dataDomRows.map(tr => [...tr.querySelectorAll(':scope > th, :scope > td')].map((cell,i) => {
        const text = semanticText(cell, { removeAnswers: true });
        const answerEl = cell.querySelector('input[id^="qn"], textarea[id^="qn"], select[id^="qn"]');
        return { text, value: parseNumericCell(text), header: headers[i] || `Column ${i+1}`, answerId: answerEl?.id || null };
      }));
      tables.push({ headers, rows, caption: normalizeText(table.querySelector('caption')?.textContent || '') });
    }
    return tables;
  }

  function answerContext(el, questionEl) {
    const label = (el.id && questionEl.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
    if (label) return semanticText(label, { removeAnswers: true });
    let cur = el.parentElement;
    for (let i=0; cur && cur !== questionEl && i<5; i++,cur=cur.parentElement) {
      const t = semanticText(cur, { removeAnswers: true });
      if (t && t.length <= 600) return t;
    }
    return '';
  }

  function extractQuestion(questionEl) {
    if (!questionEl) return null;
    const answerEls = [...questionEl.querySelectorAll('input[id^="qn"], textarea[id^="qn"], select[id^="qn"], input[name^="qn"], textarea[name^="qn"], select[name^="qn"]')];
    const uniqueAnswerEls = [...new Set(answerEls)];
    function inferKind(el) {
      const type = String(el.type || '').toLowerCase();
      const tag = el.tagName.toLowerCase();
      const mq = String(el.dataset?.mq || '').toLowerCase();
      const tip = String(el.dataset?.tip || '').toLowerCase();
      if (type === 'radio') return 'choice-single';
      if (type === 'checkbox') return 'choice-multiple';
      if (tag === 'select') return 'select';
      if (type === 'file') return 'file';
      if (tag === 'textarea') return 'essay-or-string';
      if (mq) return `math-${mq}`;
      if (/interval/.test(tip)) return 'interval';
      if (/matrix/.test(tip)) return 'matrix';
      if (/tuple|point|coordinate/.test(tip)) return 'tuple';
      if (/expression|equation|function/.test(tip)) return 'expression';
      if (/number|numeric|decimal|integer|fraction/.test(tip)) return 'number';
      if (type === 'hidden') return 'hidden';
      return 'text';
    }
    const answers = uniqueAnswerEls.map((el,index) => ({
      id: el.id || null, tag: el.tagName, type: el.type || null, name: el.name || '', value: el.value || '', checked: !!el.checked,
      dataMq: el.dataset?.mq || null, tip: el.dataset?.tip || null, kind: inferKind(el), index, context: answerContext(el, questionEl),
      options: el instanceof HTMLSelectElement ? [...el.options].map((o,i)=>({index:i,value:o.value,text:normalizeText(o.textContent),selected:o.selected})) : []
    }));
    const promptRoot = getPromptRoot(questionEl);
    const seen = new Set(), svgs = [];
    for (const svg of promptRoot.querySelectorAll('svg, embed[type="image/svg+xml"][script]')) {
      const key = `${svg.id}|${svg.getAttribute('data-script')||svg.getAttribute('script')||''}|${svg.getAttribute('width')}x${svg.getAttribute('height')}`;
      if (seen.has(key)) continue; seen.add(key);
      const r=svg.getBoundingClientRect(); if (r.width<40||r.height<40) continue;
      svgs.push(extractGraph(svg,svgs.length));
    }
    const tables = extractTables(promptRoot);
    const answerNumber = answers[0]?.id?.match(/^qn(\d+)/)?.[1] || null;
    const inferredId = answerNumber != null ? `questionwrap${answerNumber}` : null;
    const choices = answers.filter(a => ['checkbox','radio'].includes(String(a.type).toLowerCase())).map((a,i)=>({ ...a, choiceIndex:i }));
    const widgets = {
      drawing: !!questionEl.querySelector('canvas, [id*=draw i], [class*=draw i]'),
      normalCurve: !!questionEl.querySelector('[class*=normalcurve i], [id*=normalcurve i]'),
      molecule: !!questionEl.querySelector('[class*=molecule i], [id*=molecule i]'),
      fileUpload: answers.some(a => String(a.type).toLowerCase() === 'file')
    };
    const mathSources = [...promptRoot.querySelectorAll('[data-mom-tex]')].map(el=>normalizeText(el.getAttribute('data-mom-tex')||'')).filter(Boolean);
    const drawing = widgets.drawing ? {
      canvasId: questionEl.querySelector('.drawcanvas canvas')?.id || null,
      tools: [...questionEl.querySelectorAll('[data-drawaction=\"settool\"]')].map(el=>({label:normalizeText(el.getAttribute('alt')||el.getAttribute('title')||el.textContent||''), value:el.getAttribute('data-val'), selected:el.classList.contains('sel')})),
      answerId: answers.find(a=>String(a.type).toLowerCase()==='hidden')?.id || null
    } : null;
    return { id: questionEl.id || promptRoot.id || inferredId, text: cleanQuestionText(questionEl), answers, choices, graphs: svgs, tables, widgets, mathSources, drawing };
  }

  function sanitizeQuestionForCapture(info) {
    if (!info) return null;
    const copy = JSON.parse(JSON.stringify(info));
    for (const a of copy.answers || []) {
      delete a.value;
      delete a.checked;
      for (const o of a.options || []) delete o.selected;
    }
    for (const c of copy.choices || []) {
      delete c.value;
      delete c.checked;
      for (const o of c.options || []) delete o.selected;
    }
    return copy;
  }

  function capturePromptHtml(questionEl) {
    const promptRoot = getPromptRoot(questionEl);
    if (!promptRoot) return '';
    const clone = promptRoot.cloneNode(true);
    clone.querySelectorAll('script, style, noscript, iframe').forEach(el => el.remove());
    clone.querySelectorAll('input, textarea, select').forEach(el => {
      el.removeAttribute('value');
      el.removeAttribute('checked');
      el.removeAttribute('selected');
      if (el.tagName === 'TEXTAREA') el.textContent = '';
      if (el.tagName === 'SELECT') el.querySelectorAll('option').forEach(o => o.removeAttribute('selected'));
    });
    // Remove controls that are not part of the question content while retaining
    // answer-control shape and labels for parser development.
    clone.querySelectorAll('button, .submitbtnwrap, .questionhelp, [id^="pbtn"]').forEach(el => el.remove());
    return String(clone.outerHTML || '').slice(0, 160000);
  }

  function buildCaptureSnapshot(questionEl, info, reason = 'auto') {
    if (!questionEl || !info) return null;
    const promptRoot = getPromptRoot(questionEl);
    const mathSources = [...promptRoot.querySelectorAll('[data-mom-tex]')]
      .map(el => String(el.getAttribute('data-mom-tex') || '').trim())
      .filter(Boolean).slice(0, 200);
    const svgHtml = [...promptRoot.querySelectorAll('svg, embed[type="image/svg+xml"][script]')]
      .filter(svg => { const r=svg.getBoundingClientRect(); return r.width >= 40 && r.height >= 40; })
      .map(svg => String(svg.outerHTML || '').slice(0, 120000)).slice(0, 12);
    const url = new URL(location.href);
    return {
      schemaVersion: 1,
      reason,
      capturedAt: new Date().toISOString(),
      source: {
        host: url.hostname,
        path: url.pathname,
        assignmentId: url.searchParams.get('aid') || null,
        route: url.hash || ''
      },
      question: sanitizeQuestionForCapture(info),
      visual: {
        promptHtml: capturePromptHtml(questionEl),
        mathSources,
        svgHtml
      }
    };
  }

  let captureEnabled = false;
  let lastCaptureHint = '';
  let captureBusy = false;

  async function refreshCaptureEnabled() {
    try {
      const stored = await chrome.storage.local.get('captureEnabled');
      captureEnabled = stored.captureEnabled === true;
    } catch (_) { captureEnabled = false; }
  }

  async function captureCurrentQuestion(reason = 'auto', force = false, questionId = null) {
    if ((!captureEnabled && !force) || captureBusy) return { ok:false, skipped:true };
    captureBusy = true;
    try {
      try { await bridgeRequest('probe'); } catch (_) {}
      const requested=questionId?document.getElementById(String(questionId)):null;
      const qEl=requested?.matches?.('[id^="questionwrap"], .questionwrap')?requested:findActiveQuestion();
      const info = extractQuestion(qEl);
      if (!qEl || !info || !info.text) return { ok:false, skipped:true };
      if (/\bgraph\b/i.test(info.text) && !(info.graphs||[]).length) return {ok:false,skipped:true,reason:'graph-not-rendered'};
      const hint = `${location.hash}|${info.id || ''}|${info.text.slice(0,300)}|${(info.answers||[]).map(a=>a.kind).join(',')}`;
      if (!force && hint === lastCaptureHint) return { ok:false, skipped:true };
      lastCaptureHint = hint;
      const snapshot = buildCaptureSnapshot(qEl, info, reason);
      return await chrome.runtime.sendMessage({ target:'mom-helper-background', type:'capture-question', snapshot });
    } finally { captureBusy = false; }
  }

  async function captureAllQuestions() {
    const ids=findPageQuestions().map(el=>el.id).filter(Boolean);
    let saved=0,skipped=0;
    for(const id of ids){
      const result=await captureCurrentQuestion('manual-all',true,id);
      if(result?.ok||result?.deduplicated)saved++;else skipped++;
    }
    return {ok:true,total:ids.length,saved,skipped};
  }

  async function getState() {
    // Ask the page-context bridge to annotate MathJax output with its original
    // TeX before reading the question.  MathJax v3 no longer keeps the source
    // TeX in script tags, so doing this first is essential for reliable
    // extraction of limits and function notation.
    let probe=null; try { probe=await bridgeRequest('probe'); } catch (_) {}
    let activeQuestion=findActiveQuestion(), info=extractQuestion(activeQuestion);
    // MyOpenMath often inserts the question before its graph SVG.  Wait briefly
    // so solving never treats a still-rendering graph as an unsupported problem.
    for(let attempt=0;attempt<4 && info && /\bgraph\b/i.test(info.text||'') && !(info.graphs||[]).length;attempt++) {
      await new Promise(resolve=>setTimeout(resolve,150));
      try { await bridgeRequest('probe'); } catch (_) {}
      activeQuestion=findActiveQuestion(); info=extractQuestion(activeQuestion);
    }
    const questionEls=findPageQuestions();
    const questions=questionEls.map((el,index)=>{
      const question=extractQuestion(el);
      if(!question)return null;
      return {...question,pageIndex:index,pageLabel:`Question ${index+1}`};
    }).filter(Boolean);
    const activeId=info?.id||null;
    const activeFromList=questions.find(q=>q.id===activeId)||info;
    return { ok:true, hasQuestion:questions.length>0||!!info, question:activeFromList, questions, activeQuestionId:activeId, bridge:{hasMathQuill:!!probe?.hasMathQuill,hasJQuery:!!probe?.hasJQuery,annotatedMath:Number(probe?.annotatedMath||0)}, frameUrl:location.href };
  }

  function setChecked(el, checked) {
    if (!el || el.checked === checked) return;
    const type = String(el.type || '').toLowerCase();
    // Clicking is best when selecting because it triggers MyOpenMath's normal
    // handlers.  For clearing a radio, however, click() cannot unselect it, so
    // use the native property setter instead.
    if (checked) {
      try { el.click(); return; } catch (_) {}
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'checked')?.set;
    if (setter) setter.call(el,checked); else el.checked=checked;
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    if (type === 'radio' && checked) el.dispatchEvent(new Event('click',{bubbles:true}));
  }

  async function fillOne(answerId, text, dataMq) {
    if (dataMq) {
      let result;
      for(let attempt=0;attempt<3;attempt++){
        result=await bridgeRequest('fill-text',{answerId,text:String(text)});
        if(!result.error||!/(not found|not available)/i.test(result.error))break;
        await new Promise(resolve=>setTimeout(resolve,60*(attempt+1)));
      }
      if (result.error) throw new Error(result.error);
      return { answerId, requestedValue:String(text), hiddenValue:result.hiddenValue||'', latex:result.latex||'' };
    }
    const el=document.getElementById(answerId); if(!el) throw new Error(`Answer field ${answerId} not found.`);
    const value=String(text);
    if (el instanceof HTMLSelectElement) {
      const exact = [...el.options].find(o => o.value === value);
      const byText = [...el.options].find(o => normalizeText(o.textContent) === normalizeText(value));
      if (exact) el.value = exact.value;
      else if (byText) el.value = byText.value;
      else el.value=value;
    } else {
      const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set; if(setter)setter.call(el,value);else el.value=value;
    }
    el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
    return { answerId, requestedValue:value, hiddenValue:el.value, latex:'' };
  }

  const waitTick = (ms=0) => new Promise(resolve => setTimeout(resolve, ms));

  async function verifyFilledFields(results) {
    await waitTick(150);
    for(const result of results){
      const actual=document.getElementById(result.answerId)?.value;
      if(actual!==result.requestedValue)throw new Error(`MyOpenMath changed ${result.answerId} after filling (expected ${JSON.stringify(result.requestedValue)}, got ${JSON.stringify(actual)}).`);
    }
  }

  function readChoiceSelections(choiceAnswers) {
    return choiceAnswers.map((a,i)=>document.getElementById(a.id)?.checked ? i : null).filter(i=>i!=null);
  }

  function sameSelection(a,b) {
    if (a.length !== b.length) return false;
    const aa=[...a].sort((x,y)=>x-y), bb=[...b].sort((x,y)=>x-y);
    return aa.every((v,i)=>v===bb[i]);
  }

  async function applyChoiceSelections(choiceAnswers, selections) {
    const wanted=[...new Set((selections||[]).map(Number).filter(Number.isInteger))].filter(i=>i>=0 && i<choiceAnswers.length);
    const wantedSet=new Set(wanted);
    const types=choiceAnswers.map(a=>String(a.type||'').toLowerCase());
    const allRadio=types.length>0 && types.every(t=>t==='radio');
    const allCheckbox=types.length>0 && types.every(t=>t==='checkbox');

    if (allRadio) {
      if (wanted.length !== 1) return {ok:false,error:`Single-choice question expected exactly one selection; solver returned ${wanted.length}.`};
      const meta=choiceAnswers[wanted[0]];
      let el=document.getElementById(meta.id);
      if (!el) return {ok:false,error:`Choice ${wanted[0]+1} was not found.`};
      if (!el.checked) el.click();
      await waitTick(25);
      // Some MyOpenMath pages re-render the radio group after the click. Re-read
      // the DOM and retry once if necessary.
      let now=readChoiceSelections(choiceAnswers);
      if (!sameSelection(now,wanted)) {
        el=document.getElementById(meta.id);
        if (el && !el.checked) el.click();
        await waitTick(40);
        now=readChoiceSelections(choiceAnswers);
      }
      return sameSelection(now,wanted)
        ? {ok:true,selections:now}
        : {ok:false,error:`Could not select the requested radio choice. Wanted ${wanted.map(i=>i+1).join(', ')}, page has ${now.map(i=>i+1).join(', ')||'none'}.`,selections:now};
    }

    if (allCheckbox) {
      // Framework-backed checkbox groups can replace their DOM nodes after each
      // click. Work serially, re-querying by id every time, and make multiple
      // stabilization passes until the final state exactly matches the solver.
      for (let pass=0; pass<4; pass++) {
        for (let i=0;i<choiceAnswers.length;i++) {
          const meta=choiceAnswers[i];
          const el=document.getElementById(meta.id);
          if (!el) continue;
          const want=wantedSet.has(i);
          if (!!el.checked !== want) {
            el.click();
            await waitTick(18);
          }
        }
        const now=readChoiceSelections(choiceAnswers);
        if (sameSelection(now,wanted)) return {ok:true,selections:now};
        await waitTick(30);
      }
      // Final fallback: set the native checked property as one batch and emit
      // input/change events. This avoids a page click handler accidentally
      // restoring an earlier checkbox snapshot.
      for (let i=0;i<choiceAnswers.length;i++) {
        const el=document.getElementById(choiceAnswers[i].id);
        if (!el) continue;
        const want=wantedSet.has(i);
        const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'checked')?.set;
        if (setter) setter.call(el,want); else el.checked=want;
      }
      for (let i=0;i<choiceAnswers.length;i++) {
        const el=document.getElementById(choiceAnswers[i].id);
        if (!el) continue;
        el.dispatchEvent(new Event('input',{bubbles:true}));
        el.dispatchEvent(new Event('change',{bubbles:true}));
      }
      await waitTick(35);
      const now=readChoiceSelections(choiceAnswers);
      return sameSelection(now,wanted)
        ? {ok:true,selections:now}
        : {ok:false,error:`Could not stabilize checkbox selections. Wanted ${wanted.map(i=>i+1).join(', ')||'none'}, page has ${now.map(i=>i+1).join(', ')||'none'}.`,selections:now};
    }

    // Mixed/legacy choice controls: preserve the previous behavior but verify it.
    for (let i=0;i<choiceAnswers.length;i++) {
      const el=document.getElementById(choiceAnswers[i].id);
      if (el) setChecked(el,wantedSet.has(i));
    }
    await waitTick(20);
    const now=readChoiceSelections(choiceAnswers);
    return sameSelection(now,wanted)
      ? {ok:true,selections:now}
      : {ok:false,error:'Choice controls did not retain the requested selection.',selections:now};
  }

  async function fillDrawing(drawing, info) {
    if (!drawing || !info?.widgets?.drawing) return {ok:false,error:'No drawing widget found.'};
    const hiddenId=drawing.answerId||info.drawing?.answerId||info.answers.find(a=>String(a.type).toLowerCase()==='hidden')?.id;
    if(!hiddenId)return {ok:false,error:'Drawing answer field was not found.'};
    if(drawing.mode==='imathas-basic'){
      const result=await bridgeRequest('set-basic-drawing',{answerId:hiddenId,lines:drawing.lines||[],dots:drawing.dots||[],openDots:drawing.openDots||[]});
      if(result.error)return {ok:false,error:result.error,expected:result.expected,actual:result.actual};
      if(!result.verified)return {ok:false,error:'Piecewise graph serialization could not be verified, so nothing was filled.'};
      return {ok:true,hiddenValue:result.hiddenValue,drawing:true,verified:true};
    }
    if(drawing.mode!=='imathas-model'||!Number.isFinite(Number(drawing.toolMode))||!Array.isArray(drawing.points))return {ok:false,error:'This drawing does not have a supported MyOpenMath model representation.'};
    const result=await bridgeRequest('set-drawing-model',{answerId:hiddenId,mode:Number(drawing.toolMode),points:drawing.points});
    if(result.error)return {ok:false,error:result.error,expected:result.expected,actual:result.actual};
    if(!result.verified)return {ok:false,error:'Graph serialization could not be verified, so nothing was filled.'};
    return {ok:true,hiddenValue:result.hiddenValue,drawing:true,verified:true,mode:result.mode,pixels:result.pixels};
  }

  async function fillSolution(solution={}, questionId=null, expectedQuestion=null) {
    if(solution?.verification?.ok===false)return {ok:false,error:`Verification failed: ${solution.verification.detail||'the calculated answer did not pass its safety check.'}`};
    let requested=questionId?document.getElementById(String(questionId)):null;
    if(!requested&&expectedQuestion?.answerIds?.length){
      const answerEl=document.getElementById(expectedQuestion.answerIds[0]);
      requested=answerEl?.closest?.('[id^="questionwrap"], .questionwrap, .question[role="region"]')||null;
    }
    const target=requested?.matches?.('[id^="questionwrap"], .questionwrap, .question[role="region"]')?requested:findActiveQuestion();
    const info=extractQuestion(target);
    if(expectedQuestion){
      const expectedIds=(expectedQuestion.answerIds||[]).filter(Boolean),actualIds=(info?.answers||[]).map(a=>a.id).filter(Boolean);
      const sameText=normalizeText(info?.text||'')===normalizeText(expectedQuestion.text||'');
      const sameIds=expectedIds.length===actualIds.length&&expectedIds.every((id,i)=>id===actualIds[i]);
      if(info?.id!==expectedQuestion.id||!sameText||!sameIds)return {ok:false,error:'The problem changed while it was being solved, so no answer was filled. Press Solve again on the current problem.'};
    }
    if(solution?.drawing && info?.widgets?.drawing) return fillDrawing(solution.drawing, info);
    if(!info?.answers?.length) return {ok:false,error:'No answer fields found.'};
    const choiceAnswers=(info.choices || info.answers.filter(a=>['checkbox','radio'].includes(String(a.type).toLowerCase())));
    const hasNumericAnswer=Array.isArray(solution.entries)||!!solution.entryMap||solution.entry!=null;
    if(Array.isArray(solution.selections) && choiceAnswers.length && !hasNumericAnswer) {
      const applied=await applyChoiceSelections(choiceAnswers,solution.selections);
      if(!applied.ok) return applied;
      const labels=applied.selections.map(i=>choiceAnswers[i]?.context || `Choice ${i+1}`);
      return {ok:true, selections:applied.selections, hiddenValue:applied.selections.map(i=>i+1).join(','), choiceLabels:labels};
    }
    // Multiple-choice can also be rendered as a select menu. Treat the solver's
    // zero-based selection as the corresponding non-placeholder option.
    if(Array.isArray(solution.selections) && !choiceAnswers.length) {
      const selects=info.answers.filter(a=>String(a.tag).toLowerCase()==='select');
      if(selects.length===1 && solution.selections.length===1) {
        const meta=selects[0], el=document.getElementById(meta.id);
        if(el) {
          const usable=[...el.options].filter(o=>o.value!=='' && !/^select|choose/i.test(normalizeText(o.textContent)));
          const opt=usable[Number(solution.selections[0])];
          if(opt) { el.value=opt.value; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return {ok:true,selections:solution.selections,hiddenValue:el.value}; }
        }
      }
    }
    const nonChoice=info.answers.filter(a=>!['checkbox','radio','hidden'].includes(String(a.type).toLowerCase()) || !!a.dataMq);
    const entries = Array.isArray(solution.entries) ? solution.entries : null;
    const entryMap = solution.entryMap && typeof solution.entryMap === 'object' ? solution.entryMap : null;
    const results=[];
    if(!entries&&!entryMap&&nonChoice.length!==1)return {ok:false,error:`This question has ${nonChoice.length} answer fields but the solver returned only one answer; nothing was filled.`};
    const previous=nonChoice.map(a=>document.getElementById(a.id)?.value||'');
    if(entries) {
      if(entries.length!==nonChoice.length)return {ok:false,error:`Solver returned ${entries.length} answers for ${nonChoice.length} fields; nothing was filled.`};
      for(const a of nonChoice)if(!document.getElementById(a.id)||(a.dataMq&&!document.getElementById(`mqinput-${a.id}`)))return {ok:false,error:`Answer field ${a.id} is not ready; nothing was filled.`};
      try{for(let i=0;i<entries.length;i++)results.push(await fillOne(nonChoice[i].id, entries[i], nonChoice[i].dataMq));await verifyFilledFields(results);}
      catch(error){for(let i=0;i<results.length;i++){try{await fillOne(nonChoice[i].id,previous[i],nonChoice[i].dataMq);}catch(_){}}return {ok:false,error:`Multipart fill stopped and earlier fields were restored: ${error?.message||String(error)}`};}
    } else if(entryMap) {
      for(const a of nonChoice) if(Object.prototype.hasOwnProperty.call(entryMap,a.id)) results.push(await fillOne(a.id,entryMap[a.id],a.dataMq));
      if(!results.length)return {ok:false,error:'The solver did not map an answer to any field; nothing was filled.'};
    } else {
      const a=nonChoice.find(a=>a.dataMq==='calculated') || nonChoice[0];
      if(!a?.id) return {ok:false,error:'No fillable answer field found.'};
      results.push(await fillOne(a.id, solution.entry ?? solution.answer ?? '', a.dataMq));
    }
    if(!entries){try{await verifyFilledFields(results);}catch(error){return {ok:false,error:error?.message||String(error)};}}
    let appliedChoices=null;
    if(Array.isArray(solution.selections)&&choiceAnswers.length){
      appliedChoices=await applyChoiceSelections(choiceAnswers,solution.selections);
      if(!appliedChoices.ok){
        for(let i=0;i<results.length;i++){try{await fillOne(nonChoice[i].id,previous[i],nonChoice[i].dataMq);}catch(_){}}
        return {ok:false,error:`Choice selection failed and numeric fields were restored: ${appliedChoices.error||'unknown error'}`};
      }
    }
    return {ok:true, results, selections:appliedChoices?.selections, choiceLabels:appliedChoices?.selections.map(i=>choiceAnswers[i]?.context||`Choice ${i+1}`), hiddenValue:results.map(r=>r.hiddenValue).join(', '), latex:results.map(r=>r.latex).filter(Boolean).join(', ')};
  }

  chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
    if(!message||message.target!=='mom-helper-content')return;
    if(message.type==='get-state'){getState().then(sendResponse).catch(e=>sendResponse({ok:false,error:e?.message||String(e)}));return true;}
    if(message.type==='capture-current'){captureCurrentQuestion('manual', true, message.questionId||null).then(sendResponse).catch(e=>sendResponse({ok:false,error:e?.message||String(e)}));return true;}
    if(message.type==='capture-all'){captureAllQuestions().then(sendResponse).catch(e=>sendResponse({ok:false,error:e?.message||String(e)}));return true;}
    if(message.type==='fill-solution'){fillSolution(message.solution||{},message.questionId||null,message.expectedQuestion||null).then(sendResponse).catch(e=>sendResponse({ok:false,error:e?.message||String(e)}));return true;}
    if(message.type==='fill-answer'){fillSolution({entry:message.text||''},message.questionId||null).then(sendResponse).catch(e=>sendResponse({ok:false,error:e?.message||String(e)}));return true;}
  });

  document.addEventListener('pointerdown',(event)=>{const q=event.target?.closest?.('[id^="questionwrap"], .questionwrap');if(q)lastClickedQuestion=q;},true);

  refreshCaptureEnabled().then(() => { if (captureEnabled) setTimeout(() => captureCurrentQuestion('auto').catch(()=>{}), 900); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.captureEnabled) {
      captureEnabled = changes.captureEnabled.newValue === true;
      lastCaptureHint = '';
      if (captureEnabled) captureCurrentQuestion('enabled', true).catch(()=>{});
    }
  });
  setInterval(() => { if (captureEnabled) captureCurrentQuestion('auto').catch(()=>{}); }, 1400);
})();
