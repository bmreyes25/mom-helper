(() => {
  if (window.__MOM_HELPER_BRIDGE__) return;
  window.__MOM_HELPER_BRIDGE__ = true;

  function reply(requestId, payload) {
    window.postMessage({ source: 'mom-helper-page', requestId, ...payload }, '*');
  }

  function normalizeMathItemSource(math) {
    if (typeof math === 'string') return math;
    if (math == null) return '';
    try {
      if (math.outerHTML) return math.outerHTML;
      if (math.textContent) return math.textContent;
      return String(math);
    } catch (_) {
      return '';
    }
  }

  function annotateMathJax() {
    let annotated = 0;

    // MathJax v3/v4: original input is stored on MathItem.math and the
    // rendered <mjx-container> is MathItem.typesetRoot.
    try {
      const doc = window.MathJax?.startup?.document;
      const list = doc?.math;
      if (list && Symbol.iterator in Object(list)) {
        for (const item of list) {
          const root = item?.typesetRoot;
          const source = normalizeMathItemSource(item?.math);
          if (root?.setAttribute && source) {
            root.setAttribute('data-mom-tex', source);
            annotated++;
          }
        }
      }
    } catch (_) {}

    // MathJax v2 fallback.  In v2 the original source is normally in a script
    // node.  Attach it to the generated frame when one can be identified.
    try {
      const all = window.MathJax?.Hub?.getAllJax?.() || [];
      for (const jax of all) {
        const sourceEl = jax?.SourceElement?.();
        const source = sourceEl?.textContent?.trim?.() || '';
        if (!source) continue;
        const frame = document.getElementById(`${jax.inputID}-Frame`) ||
          sourceEl?.previousElementSibling || sourceEl?.nextElementSibling;
        if (frame?.setAttribute) {
          frame.setAttribute('data-mom-tex', source);
          annotated++;
        }
      }
    } catch (_) {}

    return annotated;
  }

  function getField(answerId) {
    const hidden = document.getElementById(answerId);
    const mqEl = document.getElementById(`mqinput-${answerId}`);
    if (!hidden || !mqEl) return { error: `Could not find ${answerId} / mqinput-${answerId}` };

    const MQ = window.MathQuill?.getInterface?.(2);
    if (!MQ) return { error: 'MathQuill interface 2 is not available on this page.' };

    const field = MQ(mqEl);
    if (!field) return { error: `MathQuill field not found for ${answerId}.` };
    return { hidden, mqEl, field };
  }

  function plainToLatex(input) {
    const source=String(input??'').trim();
    const tokens=[];let i=0;
    while(i<source.length){
      const c=source[i];if(/\s/.test(c)){i++;continue;}
      const number=source.slice(i).match(/^\d+(?:\.\d+)?/);if(number){tokens.push({t:'number',v:number[0]});i+=number[0].length;continue;}
      const ident=source.slice(i).match(/^[A-Za-z][A-Za-z0-9_]*/);if(ident){tokens.push({t:'ident',v:ident[0]});i+=ident[0].length;continue;}
      if('+-*/^=(),[]'.includes(c)){tokens.push({t:c,v:c});i++;continue;}
      throw new Error(`Unsupported answer character ${c}`);
    }
    tokens.push({t:'eof',v:''});
    let p=0;const peek=t=>tokens[p]?.t===t,take=t=>{const x=tokens[p];if(t&&x?.t!==t)throw new Error(`Expected ${t}`);p++;return x;};
    const identLatex=name=>{
      const lower=name.toLowerCase();
      if(lower==='oo')return '\\infty';if(name==='DNE')return '\\mathrm{DNE}';if(lower==='pi')return '\\pi';
      if(lower==='epsilon')return '\\epsilon';if(lower==='delta')return '\\delta';if(lower==='empty')return '\\varnothing';
      return name.replace(/_/g,'\\_');
    };
    function sequence(stop){const items=[union()];while(peek(',')){take(',');items.push(union());}return items.join(',');}
    function union(){let left=equality();while(peek('ident')&&tokens[p].v==='U'){take('ident');left=`${left}\\cup ${equality()}`;}return left;}
    function equality(){let left=addSub();while(peek('=')){take('=');left=`${left}=${addSub()}`;}return left;}
    function addSub(){let left=mulDiv();while(peek('+')||peek('-')){const op=take().v;left=`${left}${op}${mulDiv()}`;}return left;}
    function mulDiv(){let left=power();while(peek('*')||peek('/')){const op=take().v,right=power();left=op==='/'?`\\frac{${left}}{${right}}`:`${left}\\cdot ${right}`;}return left;}
    function power(){let base=unary();if(peek('^')){take('^');base=`${base}^{${power()}}`;}return base;}
    function unary(){if(peek('-')||peek('+'))return `${take().v}${unary()}`;return primary();}
    function primary(){
      if(peek('number'))return take('number').v;
      if(peek('ident')){
        const name=take('ident').v,lower=name.toLowerCase();
        if(peek('(')){
          take('(');const inside=peek(')')?'':sequence(')');take(')');
          if(lower==='sqrt')return `\\sqrt{${inside}}`;
          if(lower==='abs')return `\\left|${inside}\\right|`;
          if(['ln','log','sin','cos','tan','sec','csc','cot','arcsin','arccos','arctan','exp'].includes(lower))return `\\${lower}\\left(${inside}\\right)`;
          return `${identLatex(name)}\\left(${inside}\\right)`;
        }
        return identLatex(name);
      }
      if(peek('(')){take('(');const inside=sequence(')');take(')');return `\\left(${inside}\\right)`;}
      if(peek('[')){take('[');const inside=sequence(']');take(']');return `\\left[${inside}\\right]`;}
      throw new Error('Expected an answer expression');
    }
    const latex=sequence('eof');if(!peek('eof'))throw new Error('Unexpected trailing answer text');return latex;
  }

  // Exposed only to the local regression harness; normal page integration uses
  // fillWithText below.
  window.__MOM_HELPER_PLAIN_TO_LATEX__=plainToLatex;

  function fillWithText(answerId, text) {
    const result = getField(answerId);
    if (result.error) return result;
    const { hidden, field } = result;
    try {
      const plain=String(text);
      const latex=plainToLatex(plain);
      field.focus();
      field.latex(latex);
      field.blur?.();
      // MathQuill's typedText keeps its cursor inside superscripts; assigning a
      // complete structure avoids that.  Preserve MyOpenMath's canonical plain
      // answer syntax in the hidden field used for grading.
      hidden.value=plain;
      // IMathAS listens for change on this hidden input and feeds its value
      // back into MathQuill as LaTeX. Our value is grader syntax, not LaTeX;
      // that round trip rewrites (and can truncate) multipart answers.
      // MathQuill's own edit callback and this input event notify the page.
      hidden.dispatchEvent(new Event('input',{bubbles:true}));
      const verified=hidden.value===plain;
      if(!verified)return {error:'MyOpenMath did not retain the requested answer serialization.'};
      return { ok: true, hiddenValue: hidden.value, latex: field.latex(), verified };
    } catch (error) {
      return { error: error?.message || String(error) };
    }
  }

  function fillWithLatex(answerId, latex) {
    const result = getField(answerId);
    if (result.error) return result;
    const { hidden, field } = result;
    try {
      field.focus();
      field.latex('');
      if (typeof field.write === 'function') field.write(String(latex));
      else field.latex(String(latex));
      field.blur?.();
      return { ok: true, hiddenValue: hidden.value, latex: field.latex() };
    } catch (error) {
      return { error: error?.message || String(error) };
    }
  }

  function readTwoPointValue(value) {
    const sections=String(value||'').split(';;');
    const curves=[];
    const re=/\((5(?:\.\d)?|6(?:\.\d)?|7(?:\.\d)?|8(?:\.\d)?|9(?:\.\d)?),([^)]*)\)/g;
    let match;
    while((match=re.exec(sections[3]||''))){
      const values=match[2].split(',').map(Number);
      if(values.every(Number.isFinite))curves.push({mode:Number(match[1]),pixels:values});
    }
    return curves;
  }

  function setDrawingModel(answerId, mode, points) {
    const hidden=document.getElementById(answerId);
    if(!hidden)return {error:`Drawing answer ${answerId} was not found.`};
    const qn=Number(String(answerId).match(/qn(\d+)/i)?.[1]);
    if(!Number.isInteger(qn))return {error:`Could not determine the drawing question number from ${answerId}.`};
    if(!window.imathasDraw?.initCanvases||!Array.isArray(window.canvases)||!Array.isArray(window.drawla))return {error:'MyOpenMath drawing model is not available.'};
    const config=window.canvases[qn];
    if(!config)return {error:`MyOpenMath has no canvas model for question ${qn}.`};
    const numericMode=Number(mode),expected=(numericMode===8.5||numericMode===8.6||numericMode===9.2)?3:2;
    if(!Number.isFinite(numericMode)||!Array.isArray(points)||points.length!==expected)return {error:`Drawing mode ${mode} requires ${expected} control points.`};
    const [, ,xmin,xmax,ymin,ymax,border,width,height]=config.map?.((v,i)=>i<2?v:Number(v))||config;
    if(![xmin,xmax,ymin,ymax,border,width,height].every(Number.isFinite)||xmax===xmin||ymax===ymin)return {error:'MyOpenMath canvas coordinate metadata is invalid.'};
    const pixperx=(width-2*border)/(xmax-xmin),pixpery=(height-2*border)/(ymax-ymin);
    const pixels=[];
    for(const point of points){
      const x=Number(point.x),y=Number(point.y);if(!Number.isFinite(x)||!Number.isFinite(y))return {error:'A graph control point is not numeric.'};
      pixels.push(Math.round((x-xmin)*pixperx+border),Math.round(height-(y-ymin)*pixpery-border));
    }
    const oldValue=hidden.value;
    try{
      window.drawla[qn]=[[],[],[],[[numericMode,...pixels]],[],[[numericMode,points.map(p=>`(${p.x},${p.y})`).join(',')]]];
      window.imathasDraw.initCanvases(qn);
      const curves=readTwoPointValue(hidden.value),curve=curves.find(c=>Math.abs(c.mode-numericMode)<1e-9);
      const verified=!!curve&&curve.pixels.length===pixels.length&&curve.pixels.every((v,i)=>v===pixels[i]);
      if(!verified){hidden.value=oldValue;hidden.dispatchEvent(new Event('input',{bubbles:true}));hidden.dispatchEvent(new Event('change',{bubbles:true}));return {error:'MyOpenMath did not serialize the requested graph exactly; the previous drawing was restored.',expected:{mode:numericMode,pixels},actual:curves};}
      return {ok:true,hiddenValue:hidden.value,mode:numericMode,pixels,verified:true};
    }catch(error){hidden.value=oldValue;return {error:error?.message||String(error)};}
  }

  function setBasicDrawing(answerId, lines, dots, openDots) {
    const hidden=document.getElementById(answerId);
    if(!hidden)return {error:`Drawing answer ${answerId} was not found.`};
    const qn=Number(String(answerId).match(/qn(\d+)/i)?.[1]);
    if(!Number.isInteger(qn))return {error:`Could not determine the drawing question number from ${answerId}.`};
    if(!window.imathasDraw?.initCanvases||!Array.isArray(window.canvases)||!Array.isArray(window.drawla))return {error:'MyOpenMath drawing model is not available.'};
    const config=window.canvases[qn];if(!config)return {error:`MyOpenMath has no canvas model for question ${qn}.`};
    const [, ,xmin,xmax,ymin,ymax,border,width,height]=config.map?.((v,i)=>i<2?v:Number(v))||config;
    if(![xmin,xmax,ymin,ymax,border,width,height].every(Number.isFinite)||xmax===xmin||ymax===ymin)return {error:'MyOpenMath canvas coordinate metadata is invalid.'};
    const pixperx=(width-2*border)/(xmax-xmin),pixpery=(height-2*border)/(ymax-ymin);
    const pixelPoint=point=>{const x=Number(point?.x),y=Number(point?.y);if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error('A drawing point is not numeric.');return [Math.round((x-xmin)*pixperx+border),Math.round(height-(y-ymin)*pixpery-border)];};
    try{
      const linePixels=(lines||[]).map(line=>line.map(pixelPoint)).filter(line=>line.length>=2),dotPixels=(dots||[]).map(pixelPoint),openPixels=(openDots||[]).map(pixelPoint);
      if(!linePixels.length)return {error:'The piecewise drawing did not contain any line segments.'};
      const encodeLine=line=>line.map(p=>`(${p[0]},${p[1]})`).join(',');
      const encodePoints=points=>points.map(p=>`(${p[0]},${p[1]})`).join(',');
      const expected=`${linePixels.map(encodeLine).join(';')};;${encodePoints(dotPixels)};;${encodePoints(openPixels)};;;;`;
      const oldValue=hidden.value,oldDrawla=window.drawla[qn];
      const a11y=[...linePixels.map((_,i)=>[0,(lines[i]||[]).map(p=>`(${p.x},${p.y})`).join(',')]),...dotPixels.map((_,i)=>[1,`(${dots[i].x},${dots[i].y})`]),...openPixels.map((_,i)=>[2,`(${openDots[i].x},${openDots[i].y})`])];
      window.drawla[qn]=[linePixels,dotPixels,openPixels,[],[],a11y];
      window.imathasDraw.initCanvases(qn);
      const verified=hidden.value===expected;
      if(!verified){window.drawla[qn]=oldDrawla;hidden.value=oldValue;hidden.dispatchEvent(new Event('input',{bubbles:true}));hidden.dispatchEvent(new Event('change',{bubbles:true}));return {error:'MyOpenMath did not serialize the requested piecewise graph exactly; the previous drawing was restored.',expected,actual:hidden.value};}
      return {ok:true,hiddenValue:hidden.value,verified:true,lines:linePixels,dots:dotPixels,openDots:openPixels};
    }catch(error){return {error:error?.message||String(error)};}
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== 'mom-helper-content') return;

    if (msg.type === 'probe') {
      const annotatedMath = annotateMathJax();
      reply(msg.requestId, {
        ok: true,
        hasMathQuill: typeof window.MathQuill !== 'undefined',
        hasJQuery: typeof window.jQuery !== 'undefined',
        annotatedMath
      });
      return;
    }
    if (msg.type === 'fill-text') {
      reply(msg.requestId, fillWithText(msg.answerId, msg.text));
      return;
    }
    if (msg.type === 'fill-latex') {
      reply(msg.requestId, fillWithLatex(msg.answerId, msg.latex));
      return;
    }
    if (msg.type === 'set-drawing-model') {
      reply(msg.requestId, setDrawingModel(msg.answerId, msg.mode, msg.points));
      return;
    }
    if (msg.type === 'set-basic-drawing') {
      reply(msg.requestId, setBasicDrawing(msg.answerId, msg.lines, msg.dots, msg.openDots));
    }
  });
})();
