(() => {
  const core = () => self.MOMCalculusEngine?._test || {};
  const EPS = 1e-9;
  const clean = s => String(s ?? '').replace(/−/g,'-').replace(/→/g,'->').replace(/∞/g,'oo').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
  const compact = s => clean(s).replace(/\s+/g,'');
  const fmt = (x,d=10) => {
    if (!Number.isFinite(x)) return x===Infinity?'oo':x===-Infinity?'-oo':'DNE';
    if (Math.abs(x)<1e-12) x=0;
    if (Math.abs(x-Math.round(x))<1e-10) return String(Math.round(x));
    return String(Number(x.toFixed(d)));
  };
  const gcd=(a,b)=>{a=Math.abs(Math.trunc(a));b=Math.abs(Math.trunc(b));while(b)[a,b]=[b,a%b];return a||1;};
  function rat(x,maxDen=192,tol=1e-8){
    if(!Number.isFinite(x)) return null;
    if(Math.abs(x-Math.round(x))<tol) return String(Math.round(x));
    let best=null; for(let d=1;d<=maxDen;d++){const n=Math.round(x*d),e=Math.abs(n/d-x);if(!best||e<best.e)best={n,d,e};}
    if(!best||best.e>tol)return null; const g=gcd(best.n,best.d);let n=best.n/g,d=best.d/g;if(d<0){n=-n;d=-d;}return d===1?String(n):`${n}/${d}`;
  }
  const answerNum=x=>rat(x,192,1e-8)||fmt(x,10);
  function sources(problem){
    const out=[];
    for(const s of problem?.mathSources||[]) if(s && !out.includes(s)) out.push(clean(s));
    const t=clean(problem?.text||''); if(t&&!out.includes(t))out.push(t);
    return out;
  }
  function allText(problem){return clean([problem?.text||'',...(problem?.mathSources||[]),...(problem?.choices||[]).map(c=>c.context||'')].join(' '));}
  function nonChoiceAnswers(problem){return (problem?.answers||[]).filter(a=>!['radio','checkbox'].includes(String(a.type||'').toLowerCase()));}
  function choiceMode(problem){const t=(problem?.choices||[]).map(c=>String(c.type||'').toLowerCase());return t.length&&t.every(x=>x==='radio')?'single':t.length&&t.every(x=>x==='checkbox')?'multiple':'none';}
  function result(entry, steps, richSteps, debug={}, extra={}){
    return {ok:true,engine:'course-calculator',confidence:'high',entry,answer:entry,answerMath:entry,steps,richSteps,debug,...extra};
  }
  function multi(entries, steps, richSteps, debug={}, extra={}){
    return {ok:true,engine:'course-calculator',confidence:'high',entries,answer:entries.join(', '),answerMath:entries.join(','),steps,richSteps,debug,...extra};
  }
  function choiceResult(problem,selections,steps,debug={},answer=null){
    const labels=selections.map(i=>problem.choices?.[i]?.context||`Choice ${i+1}`);
    return {ok:true,engine:'course-calculator',confidence:'high',selections,answer:answer||labels.join('; '),answerMath:labels.join('; '),steps,richSteps:[{label:'Select:',formulas:labels}],debug};
  }

  // ---------- AST helpers ----------
  function parse(s){return core().parseExpr?.(s);}
  function ev(ast,env={}){return core().evalAst?.(ast,env);}
  function simp(ast){return core().simplify?.(ast)||ast;}
  function astText(ast){return core().astText?.(ast)||'';}
  function deriv(ast,v='x'){return core().derivative?.(ast,v);}
  function clone(n){return n?JSON.parse(JSON.stringify(n)):n;}
  function subst(n,varName,repl){
    if(!n)return n;
    if(n.t==='var'&&n.n===varName)return clone(repl);
    const o={...n};
    if(n.a)o.a=subst(n.a,varName,repl); if(n.b)o.b=subst(n.b,varName,repl);
    return o;
  }
  function vars(n,set=new Set()){
    if(!n)return set;if(n.t==='var'&&!['pi','e'].includes(String(n.n).toLowerCase()))set.add(n.n);
    if(n.a)vars(n.a,set);if(n.b)vars(n.b,set);return set;
  }
  function linearCoeffs(ast,v='x'){
    const f=x=>ev(ast,{[v]:x}); const y0=f(0),y1=f(1),y2=f(2);
    if(![y0,y1,y2].every(Number.isFinite))return null;
    const a=y1-y0,b=y0;if(Math.abs((2*a+b)-y2)>1e-7*Math.max(1,Math.abs(y2)))return null;
    return {a,b};
  }
  function polyCoeffs(n,v='x'){
    if(!n)return null;
    if(n.t==='num')return [n.v];
    if(n.t==='var'){
      if(n.n===v)return [0,1];
      const val=ev(n,{});return Number.isFinite(val)?[val]:null;
    }
    if(n.t==='un'){const a=polyCoeffs(n.a,v);if(!a)return null;return n.o==='-'?a.map(x=>-x):a;}
    if(n.t==='bin'){
      const A=polyCoeffs(n.a,v),B=polyCoeffs(n.b,v);
      if(n.o==='+'||n.o==='-'){
        if(!A||!B)return null;const m=Math.max(A.length,B.length),o=Array(m).fill(0);for(let i=0;i<m;i++)o[i]=(A[i]||0)+(n.o==='+'?1:-1)*(B[i]||0);return trimPoly(o);
      }
      if(n.o==='*'){
        if(!A||!B)return null;const o=Array(A.length+B.length-1).fill(0);for(let i=0;i<A.length;i++)for(let j=0;j<B.length;j++)o[i+j]+=A[i]*B[j];return trimPoly(o);
      }
      if(n.o==='/'&&B&&B.length===1&&Math.abs(B[0])>EPS){if(!A)return null;return trimPoly(A.map(x=>x/B[0]));}
      if(n.o==='^'&&A){const p=ev(n.b,{});if(Number.isInteger(p)&&p>=0&&p<=8){let o=[1];for(let k=0;k<p;k++)o=polyMul(o,A);return trimPoly(o);}}
    }
    return null;
  }
  function trimPoly(a){while(a.length>1&&Math.abs(a.at(-1))<1e-12)a.pop();return a;}
  function polyMul(a,b){const o=Array(a.length+b.length-1).fill(0);for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++)o[i+j]+=a[i]*b[j];return trimPoly(o);}
  function polyEval(c,x){let y=0;for(let i=c.length-1;i>=0;i--)y=y*x+c[i];return y;}
  function polyDivideLinear(c,a){ // divide P(x) by x-a, ascending coefficients
    const d=c.length-1;if(d<1)return null;const q=Array(d).fill(0);q[d-1]=c[d];for(let k=d-2;k>=0;k--)q[k]=c[k+1]+a*q[k+1];const rem=c[0]+a*q[0];return {q:trimPoly(q),rem};
  }
  function rootsPoly(c){
    c=trimPoly(c.slice());const d=c.length-1;if(d===1)return [-c[0]/c[1]];
    if(d===2){const [C,B,A]=c,disc=B*B-4*A*C;if(disc<-1e-12)return[];if(Math.abs(disc)<1e-12)return[-B/(2*A)];const s=Math.sqrt(Math.max(0,disc));return [(-B-s)/(2*A),(-B+s)/(2*A)].sort((a,b)=>a-b);}
    return null;
  }
  function intervalFromExcluded(points){
    const xs=[...new Set(points.filter(Number.isFinite).map(x=>Number(x.toFixed(10))))].sort((a,b)=>a-b);
    if(!xs.length)return '(-oo,oo)';const parts=[];let lo='-oo';for(const x of xs){parts.push(`(${lo},${answerNum(x)})`);lo=answerNum(x);}parts.push(`(${lo},oo)`);return parts.join('U');
  }
  function intervalLinearIneq(a,b,strict=true,positive=true){ // ax+b >0 / >=0, or <0
    if(Math.abs(a)<EPS){const ok=positive?(strict?b>0:b>=0):(strict?b<0:b<=0);return ok?'(-oo,oo)':'empty';}
    const r=-b/a;let leftPositive=a<0; if(!positive)leftPositive=!leftPositive;const br=strict?'(': '[';const brR=strict?')':']';
    return leftPositive?`(-oo,${answerNum(r)}${strict?')':']'}`:`${strict?'(':'['}${answerNum(r)},oo)`;
  }

  function parseNamedDefinitions(problem){
    const defs={};
    for(const s0 of sources(problem)){
      const s=clean(s0).replace(/(\d)\.(\d)/g,'$1¤$2');
      const re=/\b([A-Za-z])\s*\(\s*([A-Za-z])\s*\)\s*=\s*(.+?)(?=\s+and\s+(?=(?:[A-Za-z]\s*\(|lim[_\s(]|find\b|evaluate\b|compute\b|determine\b))|\s+(?:evaluate|find|compute|determine|given|where|then|what|which|write|solve|use|draw|sketch|graph|one[- ]to[- ]one)\b|[?,.;\n]|$)/gi;
      let m;
      while((m=re.exec(s))){
        const expr=clean(m[3]).replace(/\s+and$/i,'').replace(/¤/g,'.');
        if(!defs[m[1]]){try{defs[m[1]]={name:m[1],variable:m[2],expr,ast:parse(expr)};}catch(_){}}
      }
      // Short source such as "f(x)=x^2+1".
      const single=s.match(/^\s*([A-Za-z])\s*\(\s*([A-Za-z])\s*\)\s*=\s*(.+?)\s*$/);
      if(single&&!defs[single[1]]){const expr=clean(single[3]).replace(/¤/g,'.');try{defs[single[1]]={name:single[1],variable:single[2],expr,ast:parse(expr)};}catch(_){}}
    }
    return defs;
  }
  function firstDefinition(problem){const d=parseNamedDefinitions(problem);return d.f||Object.values(d)[0]||null;}
  function parseNumericArg(raw){try{return ev(parse(raw),{});}catch(_){return NaN;}}

  // ---------- 1.1 Review of Functions ----------
  function solveFunctionEvaluation(problem){
    const t=allText(problem);if(!/(evaluate|find|compute|determine)/i.test(t))return null;
    if(/minimum\s+number\s+of\s+solutions|intermediate\s+value\s+theorem/i.test(t))return null;
    const defs=parseNamedDefinitions(problem);if(!Object.keys(defs).length)return null;
    // numeric f(a), g(a)
    const asks=[...t.matchAll(/\b([A-Za-z])\s*\(\s*([+-]?(?:\d+(?:\.\d+)?|pi(?:\/\d+)?))\s*\)\s*(?:=|\?|[.,;]|$)/g)];
    const values=[];
    for(const m of asks){const d=defs[m[1]];if(!d)continue;const x=parseNumericArg(m[2]);if(!Number.isFinite(x))continue;const y=ev(d.ast,{[d.variable]:x});if(Number.isFinite(y))values.push({label:`${m[1]}(${m[2]})`,value:y});}
    if(values.length){const entries=values.map(x=>answerNum(x.value));if(entries.length!==nonChoiceAnswers(problem).length)return null;return (entries.length>1?multi:result)(entries.length>1?entries:entries[0],[...values.map((x,i)=>`Substitute ${x.label.split('(')[1].replace(')','')} into ${x.label[0]} and simplify to ${entries[i]}.`)],[{label:'Function value(s):',formulas:values.map((x,i)=>`${x.label}=${entries[i]}`)}],{type:'function-evaluation'});}
    return null;
  }

  function solveComposition(problem){
    const t=allText(problem);if(!/(composition|compose|\bf\s*[o∘]\s*g|\(f\s*[o∘]\s*g\)|f\s*\(\s*g\s*\()/i.test(t))return null;
    const defs=parseNamedDefinitions(problem);if(!defs.f||!defs.g)return null;
    let order='fg'; if(/g\s*[o∘]\s*f|g\s*\(\s*f\s*\(/i.test(t))order='gf';
    const outer=order==='fg'?defs.f:defs.g, inner=order==='fg'?defs.g:defs.f;
    const numeric=t.match(/(?:f\s*[o∘]\s*g|g\s*[o∘]\s*f|f\s*\(\s*g\s*\(|g\s*\(\s*f\s*\()[^\d+-]*([+-]?\d+(?:\.\d+)?)/i);
    if(numeric){const x=Number(numeric[1]),u=ev(inner.ast,{[inner.variable]:x}),y=ev(outer.ast,{[outer.variable]:u});if(!Number.isFinite(y))return null;const e=answerNum(y);return result(e,[`Evaluate the inside function first: ${inner.name}(${fmt(x)})=${answerNum(u)}.`,`Use that output in ${outer.name}: ${outer.name}(${answerNum(u)})=${e}.`],[{label:'Composition:',formulas:[`${outer.name}(${inner.name}(${fmt(x)}))=${e}`]}],{type:'composition-numeric'});}
    const substituted=simp(subst(outer.ast,outer.variable,inner.ast));const e=astText(substituted);if(!e)return null;return result(e,[`Start with ${outer.name}(${inner.name}(x)).`,`Substitute ${inner.expr} everywhere ${outer.variable} appears in ${outer.name}.`,`Simplify to ${e}.`],[{label:'Composition:',formulas:[`${outer.name}(${inner.name}(x))=${e}`]}],{type:'composition-symbolic'});
  }

  function solveFunctionOperations(problem){
    const t=allText(problem);const defs=parseNamedDefinitions(problem);if(!defs.f||!defs.g)return null;
    let op=null,symbol='';if(/\(f\s*\+\s*g\)|f\s*\+\s*g/i.test(t)){op='+';symbol='f+g';}else if(/\(f\s*-\s*g\)|f\s*-\s*g/i.test(t)){op='-';symbol='f-g';}else if(/\(f\s*\*\s*g\)|\(fg\)|f\s*g/i.test(t)){op='*';symbol='fg';}else if(/\(f\s*\/\s*g\)|f\s*\/\s*g/i.test(t)){op='/';symbol='f/g';}if(!op)return null;
    const ast=simp({t:'bin',o:op,a:defs.f.ast,b:defs.g.ast});const e=astText(ast);if(!e)return null;return result(e,[`Use (${symbol})(x) = f(x) ${op} g(x).`,`Substitute the two formulas and simplify.`],[{label:'Result:',formulas:[`(${symbol})(x)=${e}`]}],{type:'function-operation'});
  }

  function solveZeros(problem){
    const t=allText(problem);if(!/(zeros?|x[- ]?intercepts?|roots?)/i.test(t))return null;const d=firstDefinition(problem);if(!d)return null;const c=polyCoeffs(d.ast,d.variable);if(!c)return null;const roots=rootsPoly(c);if(!roots||!roots.length)return null;const entries=roots.map(answerNum);const e=entries.join(',');return result(e,[`Set ${d.name}(${d.variable})=0.`,`Solve the resulting polynomial equation.`,`The zero${entries.length>1?'s are':' is'} ${entries.join(', ')}.`],[{label:'Zero(s):',formulas:entries}],{type:'zeros'});
  }

  function solveEvenOdd(problem){
    const t=allText(problem);if(!/(even|odd|symmetr)/i.test(t))return null;const d=firstDefinition(problem);if(!d)return null;
    const pts=[.7,1.3,2.1,3.2];let even=true,odd=true;
    for(const x of pts){const p=ev(d.ast,{[d.variable]:x}),m=ev(d.ast,{[d.variable]:-x});if(!Number.isFinite(p)||!Number.isFinite(m))continue;if(Math.abs(m-p)>1e-7*Math.max(1,Math.abs(p),Math.abs(m)))even=false;if(Math.abs(m+p)>1e-7*Math.max(1,Math.abs(p),Math.abs(m)))odd=false;}
    const kind=even?'even':odd?'odd':'neither';const choices=problem.choices||[];if(choices.length){const idx=choices.findIndex(c=>new RegExp(`\\b${kind}\\b`,'i').test(c.context||''));if(idx>=0)return choiceResult(problem,[idx],[`Compare f(-x) with f(x) and -f(x).`,`The function is ${kind}.`],{type:'symmetry'});}
    return result(kind,[`Compute f(-x).`,`Compare it with f(x) and -f(x).`,`The function is ${kind}.`],[{label:'Symmetry:',formulas:[kind]}],{type:'symmetry'});
  }

  function solveDomainBasic(problem){
    const t=allText(problem);if(!/\bdomain\b/i.test(t))return null;
    let d=firstDefinition(problem);
    if(!d){
      const source=sources(problem).map(s=>s.match(/\by\s*=\s*(?:ln|log)\s*\([^)]*\)/i)?.[0]).find(Boolean);
      if(source){const expr=source.slice(source.indexOf('=')+1).trim();try{d={name:'y',variable:'x',expr,ast:parse(expr)};}catch(_){}}
    }
    if(!d)return null;
    let domain='(-oo,oo)',reason='Polynomials and exponential expressions are defined for every real input.';
    function collectDen(n,out=[]){if(!n)return out;if(n.t==='bin'&&n.o==='/')out.push(n.b);if(n.a)collectDen(n.a,out);if(n.b)collectDen(n.b,out);return out;}
    function collectFn(n,names,out=[]){if(!n)return out;if(n.t==='fn'&&names.includes(n.n))out.push(n);if(n.a)collectFn(n.a,names,out);if(n.b)collectFn(n.b,names,out);return out;}
    const dens=collectDen(d.ast);if(dens.length){const ex=[];for(const den of dens){const c=polyCoeffs(den,d.variable),r=c&&rootsPoly(c);if(r)ex.push(...r);}if(ex.length){domain=intervalFromExcluded(ex);reason='Exclude values that make a denominator equal to 0.';}}
    const logs=collectFn(d.ast,['ln','log']);if(logs.length===1){const lc=linearCoeffs(logs[0].a,d.variable);if(lc){domain=intervalLinearIneq(lc.a,lc.b,true,true);reason='A logarithm requires its argument to be greater than 0.';}}
    const roots=collectFn(d.ast,['sqrt']);if(roots.length===1){const lc=linearCoeffs(roots[0].a,d.variable);if(lc){domain=intervalLinearIneq(lc.a,lc.b,false,true);reason='A square root requires its radicand to be at least 0.';}}
    if(logs.length===1&&choiceMode(problem)==='single'&&nonChoiceAnswers(problem).length===1){
      const lc=linearCoeffs(logs[0].a,d.variable);
      if(lc&&Math.abs(lc.a)>EPS){
        const boundary=answerNum(-lc.b/lc.a),relation=lc.a>0?'gt':'lt';
        const choices=problem.choices||[];
        const index=choices.findIndex(c=>new RegExp(`\\b${d.variable}\\s*${relation}\\s*A\\b`,'i').test(c.context||''));
        if(index>=0)return {ok:true,engine:'course-calculator',confidence:'high',selections:[index],entries:[boundary],answer:`${d.variable} ${lc.a>0?'>':'<'} ${boundary}`,answerMath:`${d.variable}${lc.a>0?'>':'<'}${boundary}`,steps:[`The argument of the logarithm must be positive.`,`Solve this strict inequality for ${d.variable}.`,`Choose the matching inequality and enter its boundary as A.`],solution:{steps:[{explanation:'Require a positive logarithm argument.',math:[`${astText(logs[0].a)}>0`]},{explanation:`Isolate ${d.variable}.`,math:[`${d.variable}${lc.a>0?'>':'<'}${boundary}`]},{explanation:'Select the strict inequality and enter the boundary.',math:[`A=${boundary}`]}]},debug:{type:'domain-choice-boundary'}};
      }
    }
    return result(domain,[reason,`So the domain is ${domain}.`],[{label:'Domain:',formulas:[domain]}],{type:'domain'});
  }

  function solveRangeCommon(problem){
    const t=allText(problem);if(!/\brange\b/i.test(t))return null;const d=firstDefinition(problem);if(!d)return null;const s=compact(d.expr);let range=null,why='';
    // a*b^(linear)+k
    let m=s.match(/^([+-]?(?:\d+(?:\.\d+)?|\d*\/\d+))?\*?\(?([0-9.]+)\)?\^\(?[^)]*\)?([+-]\d+(?:\.\d+)?)?$/);
    if(m && /\^/.test(s)){const a=m[1]==null||m[1]===''?1:Number(m[1]);const k=Number(m[3]||0);if(Number.isFinite(a)&&Number.isFinite(k)&&a!==0){range=a>0?`(${answerNum(k)},oo)`:`(-oo,${answerNum(k)})`;why=`An exponential is always positive before the vertical scale/shift; the horizontal asymptote is y=${answerNum(k)}.`;}}
    if(!range && /sqrt/i.test(s)){const outer=linearCoeffs(d.ast,d.variable);/* transformed sqrt generally not linear, leave below */}
    if(!range){const c=polyCoeffs(d.ast,d.variable);if(c?.length===2){range='(-oo,oo)';why='A nonconstant linear function takes every real y-value.';}else if(c?.length===3){const [C,B,A]=c;if(Math.abs(A)>EPS){const yv=C-B*B/(4*A);range=A>0?`[${answerNum(yv)},oo)`:`(-oo,${answerNum(yv)}]`;why='Use the parabola vertex to find the minimum or maximum y-value.';}}}
    if(!range)return null;return result(range,[why,`So the range is ${range}.`],[{label:'Range:',formulas:[range]}],{type:'range'});
  }

  // ---------- 1.2 Linear / basic classes / piecewise ----------
  function pointPairs(t){return [...t.matchAll(/\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\)/g)].map(m=>[Number(m[1]),Number(m[2])]);}
  function solveLineQuestions(problem){
    const t=allText(problem);if(!/(slope|equation of (?:the )?line|linear function|parallel|perpendicular)/i.test(t))return null;const pts=pointPairs(t);
    if(/slope/i.test(t)&&pts.length>=2){const [[x1,y1],[x2,y2]]=pts;if(Math.abs(x2-x1)<EPS)return result('undefined',[`Use m=(y2-y1)/(x2-x1).`,`The denominator is 0, so the line is vertical and the slope is undefined.`],[{label:'Slope:',formulas:['undefined']}],{type:'line-slope'});const m=(y2-y1)/(x2-x1),e=answerNum(m);return result(e,[`Use m=(y2-y1)/(x2-x1).`,`m=(${fmt(y2)}-${fmt(y1)})/(${fmt(x2)}-${fmt(x1)})=${e}.`],[{label:'Slope:',formulas:[`m=${e}`]}],{type:'line-slope'});}
    if(/equation of (?:the )?line|find.*line/i.test(t)){
      let m=null,x0=null,y0=null;if(pts.length>=2){m=(pts[1][1]-pts[0][1])/(pts[1][0]-pts[0][0]);[x0,y0]=pts[0];}else if(pts.length===1){[x0,y0]=pts[0];const sm=t.match(/slope\s*(?:is|=)?\s*([+-]?\d+(?:\.\d+)?(?:\/\d+)?)/i);if(sm)m=parseNumericArg(sm[1]);}
      if(Number.isFinite(m)&&Number.isFinite(x0)&&Number.isFinite(y0)){if(/perpendicular/i.test(t)&&Math.abs(m)>EPS)m=-1/m;const b=y0-m*x0,e=`y=${answerNum(m)}*x${b>=0?'+':''}${answerNum(b)}`;return result(e,[`Use point-slope form y-y1=m(x-x1).`,`Substitute the known point and slope.`,`Simplify to ${e}.`],[{label:'Line:',formulas:[e]}],{type:'line-equation'});}
    }
    return null;
  }
  function solvePiecewiseValue(problem){
    const t=allText(problem);if(!/"if"|piecewise/i.test(t)||!/f\s*\(/i.test(t))return null;const m=t.match(/f\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*\)\s*(?:=|\?)/i);if(!m)return null;const x=Number(m[1]);
    const re=/\(\s*([^,]+),\s*"if",\s*x\s*(<=|>=|<|>|=|leq|geq)\s*([+-]?\d+(?:\.\d+)?)\s*\)/gi;let q;while((q=re.exec(t))){const op=q[2].replace('leq','<=').replace('geq','>='),a=Number(q[3]);const ok=op==='<'?x<a:op==='<='?x<=a:op==='>'?x>a:op==='>='?x>=a:Math.abs(x-a)<EPS;if(ok){try{const ast=parse(q[1]),y=ev(ast,{x});if(Number.isFinite(y)){const e=answerNum(y);return result(e,[`At x=${fmt(x)}, choose the piece whose condition is satisfied.`,`Evaluate that formula to get ${e}.`],[{label:'Piecewise value:',formulas:[`f(${fmt(x)})=${e}`]}],{type:'piecewise-value'});}}catch(_){}}}
    return null;
  }
  function classifyFunction(expr){
    const s=compact(expr).toLowerCase();if(/(?:ln|log)\(/.test(s))return 'logarithmic';if(/(?:^|[^a-z])e\^|\d+(?:\.\d+)?\^\(?[a-z]|\([^()]*\/[^()]*\)\^\(?[a-z]/.test(s))return 'exponential';if(/sin|cos|tan|sec|csc|cot/.test(s))return 'trigonometric';if(/sqrt/.test(s))return 'algebraic';
    // A single monomial a*x^r is a power function (including fractional/negative exponents).
    if(/^[+-]?(?:(?:\d+(?:\.\d+)?|\d*\/\d+)\*?)?x(?:\^\(?[+-]?(?:\d+(?:\.\d+)?|\d+\/\d+)\)?)?$/.test(s)&&/x/.test(s)&&/\^/.test(s))return 'power';
    if(/\//.test(s))return 'rational';
    try{const c=polyCoeffs(parse(expr),'x');if(c){const d=c.length-1;if(d===0)return 'constant';if(d===1)return 'linear';if(d===2)return 'quadratic';return 'polynomial';}}catch(_){}return 'algebraic';
  }
  function solveClassifyFunction(problem){
    const t=String(problem?.text||'');if(!/(class|type|which.*class|identify.*class)/i.test(t)||/shown\s+on\s+the\s+graph|following\s+function\s+is\s+shown/i.test(t))return null;const d=firstDefinition(problem);if(!d)return null;const kind=classifyFunction(d.expr);const choices=problem.choices||[];if(choices.length){const idx=choices.findIndex(c=>new RegExp(kind,'i').test(c.context||''));if(idx>=0)return choiceResult(problem,[idx],[`Inspect the defining operations in ${d.expr}.`,`This is a ${kind} function.`],{type:'function-class'});return null;}return result(kind,[`Inspect the defining operations in ${d.expr}.`,`This is a ${kind} function.`],[{label:'Class:',formulas:[kind]}],{type:'function-class'});
  }


  function solveIntervalNotation(problem){
    const t=allText(problem);if(!/interval\s+notation/i.test(t))return null;
    let m=t.match(/([A-Za-z])\s*(<=|>=|<|>)\s*([+-]?\d+(?:\.\d+)?)/);if(m){const op=m[2],a=m[3];const e=op==='>'?`(${a},oo)`:op==='>='?`[${a},oo)`:op==='<'?`(-oo,${a})`:`(-oo,${a}]`;return result(e,[`Translate the inequality endpoint into interval notation.`,`Use a parenthesis for a strict inequality and a bracket when the endpoint is included.`,`Answer: ${e}.`],[{label:'Interval:',formulas:[e]}],{type:'interval-notation'});}
    m=t.match(/([+-]?\d+(?:\.\d+)?)\s*(<|<=)\s*([A-Za-z])\s*(<|<=)\s*([+-]?\d+(?:\.\d+)?)/);if(m){const e=`${m[2]==='<='?'[':'('}${m[1]},${m[5]}${m[4]==='<='?']':')'}`;return result(e,[`The variable lies between ${m[1]} and ${m[5]}.`,`Use brackets for included endpoints and parentheses for excluded endpoints.`],[{label:'Interval:',formulas:[e]}],{type:'interval-notation'});}
    return null;
  }
  function solveTransformations(problem){
    const t=allText(problem);if(!/(transform|translation|shift|reflect|stretch|shrink)/i.test(t))return null;const d=firstDefinition(problem);if(!d)return null;const s=compact(d.expr);const notes=[];
    // Common parent-function form a*(x-h)^n+k or a*sqrt(x-h)+k.
    let h=0,k=0,a=1,parent=null;
    let m=s.match(/^([+-]?(?:\d+(?:\.\d+)?|\d*\/\d+))?\*?\(x([+-]\d+(?:\.\d+)?)\)\^([0-9]+)([+-]\d+(?:\.\d+)?)?$/);
    if(m){a=m[1]?parseNumericArg(m[1]):1;h=-Number(m[2]);k=Number(m[4]||0);parent=m[3]==='2'?'quadratic':`power x^${m[3]}`;}
    if(!parent){m=s.match(/^([+-]?(?:\d+(?:\.\d+)?|\d*\/\d+))?\*?sqrt\(x([+-]\d+(?:\.\d+)?)\)([+-]\d+(?:\.\d+)?)?$/i);if(m){a=m[1]?parseNumericArg(m[1]):1;h=-Number(m[2]);k=Number(m[3]||0);parent='square-root';}}
    if(!parent){m=s.match(/^([+-]?(?:\d+(?:\.\d+)?|\d*\/\d+))?\*?abs\(x([+-]\d+(?:\.\d+)?)\)([+-]\d+(?:\.\d+)?)?$/i);if(m){a=m[1]?parseNumericArg(m[1]):1;h=-Number(m[2]);k=Number(m[3]||0);parent='absolute-value';}}
    if(!parent){m=s.match(/^([+-]?(?:\d+(?:\.\d+)?|\d*\/\d+))?\*?((?:\d+(?:\.\d+)?|\([^)]*\)))\^\(?x([+-]\d+(?:\.\d+)?)?\)?([+-]\d+(?:\.\d+)?)?$/i);if(m){a=m[1]?parseNumericArg(m[1]):1;h=-Number(m[3]||0);k=Number(m[4]||0);parent='exponential';}}
    if(!parent){m=s.match(/^([+-]?(?:\d+(?:\.\d+)?|\d*\/\d+))?\*?(ln|log|sin|cos|tan)\(x([+-]\d+(?:\.\d+)?)\)([+-]\d+(?:\.\d+)?)?$/i);if(m){a=m[1]?parseNumericArg(m[1]):1;h=-Number(m[3]||0);k=Number(m[4]||0);parent=m[2].toLowerCase()==='ln'||m[2].toLowerCase()==='log'?'logarithmic':`${m[2].toLowerCase()} graph`;}}
    if(!parent)return null;
    if(Math.abs(h)>EPS)notes.push(`shift ${Math.abs(h)} unit${Math.abs(h)===1?'':'s'} ${h>0?'right':'left'}`);
    if(Math.abs(k)>EPS)notes.push(`shift ${Math.abs(k)} unit${Math.abs(k)===1?'':'s'} ${k>0?'up':'down'}`);
    if(a<0)notes.push('reflect across the x-axis');
    if(Math.abs(Math.abs(a)-1)>EPS)notes.push(`${Math.abs(a)>1?'vertical stretch':'vertical shrink'} by factor ${answerNum(Math.abs(a))}`);
    if(!notes.length)notes.push('no transformation');
    const choices=problem.choices||[];if(choices.length){const sel=[];for(let i=0;i<choices.length;i++){const c=clean(choices[i].context).toLowerCase();if(notes.some(n=>c.includes(n.replace(/unit[s]?/,'unit').toLowerCase())||(/[Rr]ight/.test(n)&&/right/.test(c))||(/[Ll]eft/.test(n)&&/left/.test(c))||(/[Uu]p/.test(n)&&/up/.test(c))||(/[Dd]own/.test(n)&&/down/.test(c))||(/reflect/.test(n)&&/reflect/.test(c))))sel.push(i);}if(sel.length)return choiceResult(problem,choiceMode(problem)==='single'?[sel[0]]:sel,[`Use the parent ${parent} function and read transformations from the formula.`,...notes],{type:'transformations'});}
    return result(notes.join('; '),[`Start with the ${parent} parent function.`,...notes.map(n=>n[0].toUpperCase()+n.slice(1)+'.')],[{label:'Transformations:',formulas:notes}],{type:'transformations'});
  }
  function dataScriptPaths(graph){
    const out=[],script=String(graph?.dataScript||'');let m;
    const re=/path\s*\(\s*(\[\[[\s\S]*?\]\])\s*\)\s*;/g;
    while((m=re.exec(script))){try{const pts=JSON.parse(m[1]).filter(p=>Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(Number.isFinite)).map(p=>p.slice(0,2));if(pts.length>=2)out.push(pts);}catch(_){}}
    return out;
  }
  function solveGraphDomainRange(problem){
    const t=allText(problem);if(!/(domain|range)/i.test(t)||(problem.graphs||[]).length!==1)return null;const g=problem.graphs[0],scriptSegs=dataScriptPaths(g),segs=scriptSegs.length?scriptSegs:graphDataSegments(g);if(!segs.length)return null;const pts=segs.flat();let xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);let xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys);const gx0=Number(g.xmin),gx1=Number(g.xmax),gy0=Number(g.ymin),gy1=Number(g.ymax);const tol=.15;
    const domLo=Number.isFinite(gx0)&&Math.abs(xmin-gx0)<tol?'-oo':answerNum(xmin),domHi=Number.isFinite(gx1)&&Math.abs(xmax-gx1)<tol?'oo':answerNum(xmax);const ranLo=Number.isFinite(gy0)&&Math.abs(ymin-gy0)<tol?'-oo':answerNum(ymin),ranHi=Number.isFinite(gy1)&&Math.abs(ymax-gy1)<tol?'oo':answerNum(ymax);
    const script=String(g.dataScript||'');
    const closedAt=(x,y)=>script.includes(`dot([${answerNum(x)},${answerNum(y)}],"closed")`)||script.includes(`dot([${answerNum(x)}, ${answerNum(y)}],"closed")`);
    const dLeft=domLo!=='-oo'&&pts.some(p=>Math.abs(p[0]-xmin)<1e-8&&closedAt(p[0],p[1])),dRight=domHi!=='oo'&&pts.some(p=>Math.abs(p[0]-xmax)<1e-8&&closedAt(p[0],p[1]));
    const rLeft=ranLo!=='-oo'&&pts.some(p=>Math.abs(p[1]-ymin)<1e-8&&closedAt(p[0],p[1])),rRight=ranHi!=='oo'&&pts.some(p=>Math.abs(p[1]-ymax)<1e-8&&closedAt(p[0],p[1]));
    const dom=`${dLeft?'[':'('}${domLo},${domHi}${dRight?']':')'}`,ran=`${rLeft?'[':'('}${ranLo},${ranHi}${rRight?']':')'}`;const asksD=/domain/i.test(t),asksR=/range/i.test(t),fields=nonChoiceAnswers(problem).length;
    const steps=[`Read the horizontal endpoints of the graph: ${domLo} and ${domHi}.`,`Read the lowest and highest plotted values: ${ranLo} and ${ranHi}.`,`Closed dots include their endpoints.`];
    if(asksD&&asksR&&fields>=4)return multi([domLo,domHi,ranLo,ranHi],steps,[{label:'Domain bounds:',formulas:[domLo,domHi]},{label:'Range bounds:',formulas:[ranLo,ranHi]}],{type:'graph-domain-range-bounds'});
    if(asksD&&asksR&&fields>=2)return multi([dom,ran],steps,[{label:'Domain and range:',formulas:[dom,ran]}],{type:'graph-domain-range'});if(asksD)return result(dom,[`Project the graph onto the x-axis.`,`Domain: ${dom}.`],[{label:'Domain:',formulas:[dom]}],{type:'graph-domain'});if(asksR)return result(ran,[`Project the graph onto the y-axis.`,`Range: ${ran}.`],[{label:'Range:',formulas:[ran]}],{type:'graph-range'});return null;
  }
  function solveInverseVerification(problem){
    const t=allText(problem);if(choiceMode(problem)==='none'||!/(are.*inverses|verify.*inverse|inverse.*true|inverse.*false)/i.test(t))return null;const defs=parseNamedDefinitions(problem);if(!defs.f||!defs.g)return null;let ok=true;for(const x of [-3,-1,.5,2,4]){const gx=ev(defs.g.ast,{[defs.g.variable]:x}),fg=ev(defs.f.ast,{[defs.f.variable]:gx}),fx=ev(defs.f.ast,{[defs.f.variable]:x}),gf=ev(defs.g.ast,{[defs.g.variable]:fx});if(![fg,gf].every(Number.isFinite)||Math.abs(fg-x)>1e-6||Math.abs(gf-x)>1e-6){ok=false;break;}}
    const choices=problem.choices||[];const idx=choices.findIndex(c=>ok?/true|yes|are inverses/i.test(c.context||''):/false|no|not.*inverse/i.test(c.context||''));if(idx<0)return null;return choiceResult(problem,[idx],[`Check f(g(x)) and g(f(x)).`,ok?'Both compositions return x, so the functions are inverses.':'At least one composition does not return x, so the functions are not inverses.'],{type:'inverse-verification'});
  }
  function solveInverseRangeDomainTF(problem){
    const t=String(problem?.text||'');if(!/range\s+of\s+f\s*\(x\).*domain\s+of\s+f\s*\^\s*\(?-1\)?/i.test(t)||choiceMode(problem)!=='single')return null;
    const intervals=[...t.matchAll(/\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\)/g)].map(m=>[Number(m[1]),Number(m[2])]);if(intervals.length<2)return null;
    const same=intervals[0].every((v,i)=>Math.abs(v-intervals[1][i])<EPS),idx=(problem.choices||[]).findIndex(c=>clean(c.context).toLowerCase()===(same?'true':'false'));if(idx<0)return null;
    return choiceResult(problem,[idx],[`The domain of f^(-1) equals the range of f.`,`The stated intervals ${same?'match':'do not match'}, so the statement is ${same?'true':'false'}.`],{type:'inverse-range-domain-true-false'});
  }
  function solveIVTChoice(problem){
    const t=String(problem?.text||'');if(choiceMode(problem)!=='single'||!/continuous\s+function.*interval/i.test(t)||!/f\s*\(x\)\s*=\s*0\s+for\s+some/i.test(t))return null;
    const interval=t.match(/interval\s*\[\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\]/i);if(!interval)return null;
    const a=Number(interval[1]),b=Number(interval[2]),fa=t.match(new RegExp(`f\\s*\\(\\s*${a}\\s*\\)\\s*=\\s*([+-]?\\d+(?:\\.\\d+)?)`)),fb=t.match(new RegExp(`f\\s*\\(\\s*${b}\\s*\\)\\s*=\\s*([+-]?\\d+(?:\\.\\d+)?)`));if(!fa||!fb)return null;
    const forced=Number(fa[1])*Number(fb[1])<=0,label=forced?'Always true':'Sometimes true and sometimes false',idx=(problem.choices||[]).findIndex(c=>clean(c.context).toLowerCase()===label.toLowerCase());if(idx<0)return null;
    return choiceResult(problem,[idx],[`The function is continuous on [${a},${b}].`,`Its endpoint values are ${fa[1]} and ${fb[1]}.`,forced?'Since the values straddle zero, the Intermediate Value Theorem guarantees a zero in the interval.':'These endpoint values do not force a zero, though the function could still have one.'],{type:'ivt-zero-choice'});
  }
  function solveLimitLawChoice(problem){
    const t=allText(problem);if(choiceMode(problem)==='none'||!/limit\s+law|which.*law/i.test(t))return null;let want=null;if(/product/i.test(t))want='product';else if(/quotient|fraction/i.test(t))want='quotient';else if(/sum|add/i.test(t))want='sum';else if(/difference|subtract/i.test(t))want='difference';else if(/constant\s+multiple/i.test(t))want='constant';else if(/power/i.test(t))want='power';else if(/root/i.test(t))want='root';if(!want)return null;const idx=(problem.choices||[]).findIndex(c=>new RegExp(want,'i').test(c.context||''));if(idx<0)return null;return choiceResult(problem,[idx],[`Identify the outer algebraic operation in the limit expression.`,`Apply the ${want} limit law.`],{type:'limit-law'});
  }
  function solvePiecewiseDrawing(problem){
    if(!problem?.widgets?.drawing||!/sketch\s+(?:a\s+)?graph/i.test(allText(problem)))return null;
    const source=sources(problem).find(s=>/"if"/i.test(s));if(!source)return null;
    const compactSource=compact(source),pieces=[];let m;const re=/(?:\{|,)\(([^,]+),"if",([^\)]+)\)/gi;
    while((m=re.exec(compactSource))){let ast;try{ast=parse(m[1]);}catch(_){return null;}if(!ast)return null;pieces.push({expr:m[1],ast,cond:m[2]});}
    if(pieces.length<2)return null;
    const graph=(problem.graphs||[]).find(g=>g.xmin!=null&&g.xmax!=null&&Number.isFinite(Number(g.xmin))&&Number.isFinite(Number(g.xmax)));if(!graph)return null;
    const xmin=Number(graph.xmin),xmax=Number(graph.xmax),bounds=[];
    for(const p of pieces)for(const hit of p.cond.matchAll(/[+-]?\d+(?:\.\d+)?/g))bounds.push(Number(hit[0]));
    const cut=[...new Set(bounds)].filter(Number.isFinite).sort((a,b)=>a-b);if(!cut.length)return null;
    const describes=(cond,x)=>{let m=cond.match(/^([+-]?\d+(?:\.\d+)?)(lt|le)x(lt|le)([+-]?\d+(?:\.\d+)?)$/);if(m){const lo=Number(m[1]),hi=Number(m[4]);return (m[2]==='le'?lo<=x:lo<x)&&(m[3]==='le'?x<=hi:x<hi);}m=cond.match(/^x(le|lt|ge|gt)([+-]?\d+(?:\.\d+)?)$/);if(!m)return false;const a=Number(m[2]);return m[1]==='le'?x<=a:m[1]==='lt'?x<a:m[1]==='ge'?x>=a:x>a;};
    const rawLines=[],atBoundary=new Map();
    for(let i=0;i<pieces.length;i++){
      const p=pieces[i],probes=[xmin,...cut,xmax],valid=[];
      for(let j=0;j<probes.length-1;j++){const mid=(probes[j]+probes[j+1])/2;if(describes(p.cond,mid))valid.push([probes[j],probes[j+1]]);}
      if(!valid.length)continue;const lo=Math.min(...valid.map(v=>v[0])),hi=Math.max(...valid.map(v=>v[1])),ylo=ev(p.ast,{x:lo}),yhi=ev(p.ast,{x:hi});if(![ylo,yhi].every(Number.isFinite))return null;rawLines.push([{x:lo,y:ylo},{x:hi,y:yhi}]);
      for(const b of [lo,hi].filter(x=>cut.includes(x))){const y=ev(p.ast,{x:b});if(!Number.isFinite(y))continue;const rows=atBoundary.get(b)||[];rows.push({y,included:describes(p.cond,b)});atBoundary.set(b,rows);}
    }
    const lines=[];for(const line of rawLines){const prev=lines.at(-1),a=line[0],b=line[1];if(prev&&Math.abs(prev.at(-1).x-a.x)<1e-9&&Math.abs(prev.at(-1).y-a.y)<1e-9)prev.push(b);else lines.push(line);}
    const dots=[],openDots=[];for(const [boundary,rows] of atBoundary){const ys=[...new Set(rows.map(r=>answerNum(r.y)))];if(ys.length<2)continue;for(const y of ys){const group=rows.filter(r=>answerNum(r.y)===y),point={x:Number(boundary),y:Number(y)};(group.some(r=>r.included)?dots:openDots).push(point);}}
    const verified=lines.length>0&&lines.every(line=>line.every(point=>pieces.some(p=>describes(p.cond,point.x)&&Math.abs(ev(p.ast,{x:point.x})-point.y)<1e-7)||cut.includes(point.x)));
    const answerId=(problem.answers||[]).find(a=>String(a.type).toLowerCase()==='hidden')?.id||null;
    return {ok:true,engine:'course-calculator',confidence:'high',answer:'piecewise graph',answerMath:source,steps:['Split the formula at its stated boundary values.',...pieces.map(p=>`Graph ${p.expr} where ${p.cond}.`),'Use a closed dot where equality is included and an open dot where it is excluded.'],richSteps:[{label:'Piecewise rule:',formulas:[source]},{label:'Boundary points:',formulas:[...dots.map(p=>`closed (${p.x},${p.y})`),...openDots.map(p=>`open (${p.x},${p.y})`)]}],drawing:{mode:'imathas-basic',answerId,lines,dots,openDots,graph:{xmin:graph.xmin,xmax:graph.xmax,ymin:graph.ymin,ymax:graph.ymax}},verification:{ok:verified,method:'piecewise-sampling',detail:'Every generated segment endpoint was evaluated from its piecewise formula.'},debug:{type:'piecewise-drawing'}};
  }
  function solveCommonDrawing(problem){
    if(!problem?.widgets?.drawing||!/draw\s+the\s+graph|sketch\s+(?:the\s+)?graph/i.test(allText(problem)))return null;const d=firstDefinition(problem),g=(problem.graphs||[])[0];if(!d||!g)return null;const cls=classifyFunction(d.expr);const xmin=Number(g.xmin??-10),xmax=Number(g.xmax??10),ymin=Number(g.ymin??-10),ymax=Number(g.ymax??10);const candidates=[];
    const step=cls==='exponential'?0.25:1;
    for(let x=Math.ceil(xmin/step)*step;x<=xmax+EPS;x+=step){const xx=Number(x.toFixed(8)),y=ev(d.ast,{[d.variable]:xx});if(Number.isFinite(y)&&y>ymin+.2&&y<ymax-.2)candidates.push({x:xx,y});}
    if(candidates.length<2)return null;
    let p1=candidates[Math.floor(candidates.length/3)],p2=candidates[Math.floor(2*candidates.length/3)];
    if(cls==='exponential'){
      let best=null;
      for(const a of candidates)for(const b of candidates){if(b.x<=a.x)continue;const dx=b.x-a.x,dy=Math.abs(b.y-a.y);if(dx<.5||dx>2.5||dy<.35)continue;const gridPenalty=Math.abs(a.x-Math.round(a.x))+Math.abs(b.x-Math.round(b.x))+Math.abs(a.y-Math.round(a.y))+Math.abs(b.y-Math.round(b.y));const score=Math.abs(dx-1)+1/Math.max(.1,dy)+.02*(Math.abs(a.x)+Math.abs(b.x))+5*gridPenalty;if(!best||score<best.score)best={a,b,score};}
      if(best){p1=best.a;p2=best.b;}
    }
    if(cls==='quadratic'){const c=polyCoeffs(d.ast,d.variable);if(c?.length===3){const xv=-c[1]/(2*c[2]),yv=ev(d.ast,{[d.variable]:xv});if(Number.isFinite(yv)&&xv>=xmin&&xv<=xmax&&yv>=ymin&&yv<=ymax)p1={x:xv,y:yv};}}
    const tools=problem.drawing?.tools||[];const keys={linear:['line'],quadratic:['parabola','quadratic'],exponential:['exponential'],logarithmic:['logarithm','log'],algebraic:['square root','absolute']};let toolMeta=null;for(const k of keys[cls]||[]){toolMeta=tools.find(x=>String(x.label||'').toLowerCase().includes(k));if(toolMeta)break;}if(!toolMeta)toolMeta=tools.find(x=>!/eraser|clear/i.test(String(x.label||'')))||null;
    const fallbackModes={linear:5,quadratic:6,exponential:8.3,logarithmic:8.4};const mode=Number(toolMeta?.value??fallbackModes[cls]);const tool=toolMeta?.label||({linear:'Line',quadratic:'Parabola',exponential:'Exponential',logarithmic:'Logarithm'}[cls]||null);if(!tool||!Number.isFinite(mode))return null;
    const sampled=[p1,p2].every(p=>Math.abs(ev(d.ast,{[d.variable]:p.x})-p.y)<1e-8);
    return {ok:true,engine:'course-calculator',confidence:'high',answer:d.expr,answerMath:`${d.name}(${d.variable})=${d.expr}`,steps:[`Recognize the graph as ${cls}.`,`Choose two well-separated points on the function.`,`Enter (${fmt(p1.x)},${answerNum(p1.y)}) and (${fmt(p2.x)},${answerNum(p2.y)}) through MyOpenMath's drawing model.`],richSteps:[{label:'Function:',formulas:[`${d.name}(${d.variable})=${d.expr}`]},{label:'Verified control points:',formulas:[`(${fmt(p1.x)},${answerNum(p1.y)})`,`(${fmt(p2.x)},${answerNum(p2.y)})`]}],drawing:{mode:'imathas-model',tool,toolMode:mode,points:[p1,p2],answerId:(problem.answers||[]).find(a=>String(a.type).toLowerCase()==='hidden')?.id||null,graph:{xmin:g.xmin,xmax:g.xmax,ymin:g.ymin,ymax:g.ymax,xunitlength:g.xunitlength,yunitlength:g.yunitlength,ox:g.ox,oy:g.oy}},verification:{ok:sampled,method:'function-sampling',detail:'Both serialized control points were evaluated from the parsed function.'},debug:{type:'common-drawing',class:cls,tool,mode}};
  }

  // ---------- 1.3 Trigonometry ----------
  function anglePiText(theta){
    const q=theta/Math.PI;const r=rat(q,24,1e-9);if(!r)return fmt(theta);if(r==='0')return '0';if(r==='1')return 'pi';if(r==='-1')return '-pi';if(r.includes('/')){const [n,d]=r.split('/');return n==='1'?`pi/${d}`:n==='-1'?`-pi/${d}`:`${n}*pi/${d}`;}return `${r}*pi`;
  }
  function exactSurd(v){
    const vals=[
      [0,'0'],[.5,'1/2'],[-.5,'-1/2'],[1,'1'],[-1,'-1'],
      [Math.SQRT1_2,'sqrt(2)/2'],[-Math.SQRT1_2,'-sqrt(2)/2'],
      [Math.sqrt(3)/2,'sqrt(3)/2'],[-Math.sqrt(3)/2,'-sqrt(3)/2'],
      [1/Math.sqrt(3),'sqrt(3)/3'],[-1/Math.sqrt(3),'-sqrt(3)/3'],
      [Math.sqrt(3),'sqrt(3)'],[-Math.sqrt(3),'-sqrt(3)']
    ];for(const [x,s] of vals)if(Math.abs(v-x)<1e-9)return s;return answerNum(v);
  }
  function solveAngleConversion(problem){
    const t=allText(problem);if(!/convert|degrees?|radians?/i.test(t))return null;
    let m=t.match(/([+-]?\d+(?:\.\d+)?)\s*(?:degrees?|°)[\s\S]*?(?:radians?|rad)/i);if(m){const deg=Number(m[1]),rad=deg*Math.PI/180,e=anglePiText(rad);return result(e,[`Multiply degrees by pi/180.`,`(${fmt(deg)})(pi/180)=${e}.`],[{label:'Radians:',formulas:[e]}],{type:'deg-to-rad'});}
    m=t.match(/([+-]?(?:(?:\d+(?:\.\d+)?)?\*?pi(?:\/\d+(?:\.\d+)?)?|\d+(?:\.\d+)?))\s*(?:radians?|rad)?[\s\S]*?(?:degrees?|°)/i);if(m&&/pi/.test(m[1])){const rad=parseNumericArg(m[1]),deg=rad*180/Math.PI,e=answerNum(deg);return result(e,[`Multiply radians by 180/pi.`,`(${m[1]})(180/pi)=${e} degrees.`],[{label:'Degrees:',formulas:[e]}],{type:'rad-to-deg'});}
    return null;
  }
  function solveTrigExact(problem){
    const t=allText(problem);const m=t.match(/\b(sin|cos|tan|sec|csc|cot)\s*\(?\s*([^\)\n=]+)\s*\)?/i);if(!m||!/(evaluate|find|exact|value)/i.test(t))return null;let theta;try{theta=parseNumericArg(m[2]);}catch(_){return null;}if(!Number.isFinite(theta))return null;const fn=m[1].toLowerCase();let v={sin:Math.sin,cos:Math.cos,tan:Math.tan,sec:x=>1/Math.cos(x),csc:x=>1/Math.sin(x),cot:x=>1/Math.tan(x)}[fn](theta);if(!Number.isFinite(v)||Math.abs(v)>1e10)return result('undefined',[`${fn} is undefined at ${m[2]}.`],[{label:'Value:',formulas:['undefined']}],{type:'trig-exact'});const e=exactSurd(v);return result(e,[`Locate ${m[2]} on the unit circle.`,`Use the exact ${fn} coordinate/ratio: ${e}.`],[{label:'Exact value:',formulas:[`${fn}(${m[2]})=${e}`]}],{type:'trig-exact'});
  }
  function solveTrigEquationCourse(problem){
    const t=allText(problem),s=compact(t);if(!/(findallsolutions|solve).*equation/i.test(s)||!/0(?:<=|le)x<2\*?pi/i.test(s))return null;
    const m=s.match(/([+-]?\d+(?:\.\d+)?)\*?(sin|cos)\(?x\)?([+-]\d+(?:\.\d+)?)=0/i);if(!m)return null;
    const a=Number(m[1]),b=Number(m[3]),target=-b/a,fn=m[2].toLowerCase();if(!Number.isFinite(target)||Math.abs(target)>1)return null;
    let values;if(fn==='cos'){const q=Math.acos(target);values=[q,2*Math.PI-q];}else{let q=Math.asin(target);if(q<0)q+=2*Math.PI;values=[q,(Math.PI-q+2*Math.PI)%(2*Math.PI)];}
    values=[...new Set(values.map(x=>Number(x.toFixed(12))))].sort((x,y)=>x-y);const entries=values.map(anglePiText);if(entries.length!==nonChoiceAnswers(problem).length)return null;
    return multi(entries,[`Isolate the trig function: ${fn}(x)=${exactSurd(target)}.`,`Use the unit circle to find every angle in 0 <= x < 2pi with that value.`,`Order the solutions: ${entries.join(', ')}.`],[{label:'Unit-circle equation:',formulas:[`${fn}(x)=${exactSurd(target)}`]},{label:'Solutions:',formulas:entries}],{type:'trig-equation'});
  }
  function solveQuadraticTrigEquation(problem){
    const t=String(problem?.text||'');if(!/solve|find all solutions/i.test(t)||!/0\s*<=\s*[a-z]\s*<\s*2\s*\*?\s*pi/i.test(t))return null;
    const src=sources(problem).find(s=>/(?:sin|cos)\s*\^\s*2\s*\(/i.test(s));if(!src)return null;
    const m=src.match(/(sin|cos)\s*\^\s*2\s*\(\s*([a-z])\s*\)/i);if(!m)return null;const fn=m[1].toLowerCase(),variable=m[2];
    let expression=compact(src).split('=')[0];const sq=new RegExp(`${fn}\\^2\\(${variable}\\)`,'gi'),linear=new RegExp(`${fn}\\(${variable}\\)`,'gi');expression=expression.replace(sq,'u^2').replace(linear,'u');
    let coeff;try{coeff=polyCoeffs(parse(expression),'u');}catch(_){return null;}if(!coeff||coeff.length!==3)return null;
    const roots=rootsPoly(coeff).filter(v=>v>=-1-EPS&&v<=1+EPS),angles=[];
    for(const value of roots){if(fn==='cos'){const a=Math.acos(Math.max(-1,Math.min(1,value)));angles.push(a,2*Math.PI-a);}else{let a=Math.asin(Math.max(-1,Math.min(1,value)));if(a<0)a+=2*Math.PI;angles.push(a,(Math.PI-a+2*Math.PI)%(2*Math.PI));}}
    const ordered=[...new Set(angles.filter(v=>v>=0&&v<2*Math.PI-1e-8).map(v=>Number(v.toFixed(12))))].sort((a,b)=>a-b);if(!ordered.length)return null;
    const values=ordered.map(anglePiText),entry=values.join(',');if(nonChoiceAnswers(problem).length!==1)return null;
    const verified=ordered.every(angle=>{const u=fn==='cos'?Math.cos(angle):Math.sin(angle);return Math.abs(coeff[0]+coeff[1]*u+coeff[2]*u*u)<1e-7;});
    return result(entry,[`Let u=${fn}(${variable}), giving ${expression}=0.`,`Solve the quadratic for u: ${roots.map(exactSurd).join(', ')}.`,`Find every unit-circle angle in 0 <= ${variable} < 2pi and list them in order: ${entry}.`],[{label:'Substitution:',formulas:[`${expression}=0`]},{label:'Trig values:',formulas:roots.map(exactSurd)},{label:'Solutions:',formulas:values}],{type:'quadratic-trig-equation'},{verification:{ok:verified,method:'substitution',detail:'Every listed angle satisfies the original quadratic trig equation.'}});
  }
  function solveCompoundTrigExact(problem){
    const t=compact(problem?.text||sources(problem)[0]||'');if(!/(withoutusingacalculator|exactvalue)/i.test(t))return null;
    const re=/([+-]?\d+(?:\.\d+)?)\*?(sin|cos|tan|sec|csc|cot)\^([1-9]\d*)\(\s*([+-]?\d+(?:\.\d+)?)\^@\s*\)/gi;let m,total=0,count=0;const shown=[];
    while((m=re.exec(t))){const coef=Number(m[1]),fn=m[2].toLowerCase(),pow=Number(m[3]),deg=Number(m[4]),theta=deg*Math.PI/180;const base={sin:Math.sin,cos:Math.cos,tan:Math.tan,sec:x=>1/Math.cos(x),csc:x=>1/Math.sin(x),cot:x=>1/Math.tan(x)}[fn](theta);if(!Number.isFinite(base))return null;total+=coef*Math.pow(base,pow);count++;shown.push(`${coef}*(${exactSurd(base)})^${pow}`);}
    if(count<2)return null;const e=exactSurd(total);return result(e,[`Evaluate each trig value using the unit circle.`,`Substitute the exact values: ${shown.join(' + ')}.`,`Simplify to ${e}.`],[{label:'Exact substitution:',formulas:shown},{label:'Exact value:',formulas:[e]}],{type:'compound-trig-exact'});
  }
  function solveInverseTrig(problem){
    const t=allText(problem);const m=t.match(/\b(arcsin|asin|arccos|acos|arctan|atan)\s*\(?\s*([^\)\n=]+)\s*\)?/i);if(!m||!/(evaluate|find|exact|value)/i.test(t))return null;let x;try{x=parseNumericArg(m[2]);}catch(_){return null;}if(!Number.isFinite(x))return null;const fn=m[1].toLowerCase();let v=fn.includes('sin')?Math.asin(x):fn.includes('cos')?Math.acos(x):Math.atan(x);if(!Number.isFinite(v))return null;const e=anglePiText(v);return result(e,[`Use the principal range of ${m[1]}.`,`Find the angle whose corresponding trig value is ${m[2]}.`,`The principal angle is ${e}.`],[{label:'Inverse trig value:',formulas:[`${m[1]}(${m[2]})=${e}`]}],{type:'inverse-trig'});
  }
  function solveTrigPeriod(problem){
    const t=allText(problem);if(!/period/i.test(t))return null;const d=firstDefinition(problem);if(!d)return null;const s=compact(d.expr);const fm=s.match(/(sin|cos|tan)\(([^)]*)\)/i);if(!fm)return null;let a;try{const lc=linearCoeffs(parse(fm[2]),d.variable);a=lc?.a;}catch(_){return null;}if(!Number.isFinite(a)||Math.abs(a)<EPS)return null;const base=fm[1].toLowerCase()==='tan'?Math.PI:2*Math.PI,e=anglePiText(base/Math.abs(a));return result(e,[`${fm[1]} has base period ${fm[1].toLowerCase()==='tan'?'pi':'2pi'}.`,`Divide by |${answerNum(a)}| to get ${e}.`],[{label:'Period:',formulas:[e]}],{type:'trig-period'});
  }
  function solveTrigIdentityChoice(problem){
    if(choiceMode(problem)==='none'||!/(identity|equivalent|true.*trig)/i.test(allText(problem)))return null;const choices=problem.choices||[];const good=[];
    for(let i=0;i<choices.length;i++){const s=clean(choices[i].context);const eq=s.split('=');if(eq.length!==2)continue;try{const A=parse(eq[0]),B=parse(eq.slice(1).join('='));let ok=true;for(const x of [.31,.77,1.19,2.03]){const a=ev(A,{x}),b=ev(B,{x});if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a-b)>1e-7*Math.max(1,Math.abs(a),Math.abs(b))){ok=false;break;}}if(ok)good.push(i);}catch(_){}}
    if(!good.length)return null;return choiceResult(problem,choiceMode(problem)==='single'?[good[0]]:good,['Test the candidate identities using standard trig identities/equivalent expressions.','Select the identity or identities that agree for all tested angles.'],{type:'trig-identity'});
  }

  // ---------- 1.4 Inverse functions ----------
  function graphDataSegments(graph){return (graph?.segments||[]).filter(s=>{const st=String(s.stroke||'').toLowerCase();const w=Number(s.strokeWidth);return s.points?.length>=2 && !(st.includes('757575')||st.includes('gray')||st.includes('grey')) && !(w>0&&w<0.7);}).map(s=>s.points);}
  function graphPassesLineTest(graph,axis='vertical'){
    const scripted=dataScriptPaths(graph),segs=scripted.length?scripted:graphDataSegments(graph);if(!segs.length)return null;const pts=segs.flat();if(pts.length<4)return null;const coord=axis==='vertical'?0:1,other=axis==='vertical'?1:0;const vals=pts.map(p=>p[coord]);const lo=Math.min(...vals),hi=Math.max(...vals);for(let k=0;k<40;k++){const q=lo+(hi-lo)*(k+.5)/40;const hits=[];for(const seg of segs){for(let i=0;i<seg.length-1;i++){const a=seg[i],b=seg[i+1],u=a[coord],v=b[coord];if((u<=q&&q<v)||(v<=q&&q<u)){const tt=(q-u)/(v-u);hits.push(a[other]+tt*(b[other]-a[other]));}}}hits.sort((a,b)=>a-b);let distinct=0,last=null;for(const h of hits){if(last==null||Math.abs(h-last)>0.08){distinct++;last=h;}}if(distinct>1)return false;}return true;
  }
  function solveRelationIsFunction(problem){
    const t=allText(problem);
    if(!/(?:is|does).*?(?:relation|set of ordered pairs|table|graph).*?(?:a function|represent a function)|which.*relation.*function|determine whether.*function/i.test(t))return null;
    let isFn=null,reason='';
    const pts=pointPairs(t);
    if(pts.length>=2){
      const seen=new Map();isFn=true;
      for(const [x,y] of pts){if(seen.has(x)&&Math.abs(seen.get(x)-y)>EPS){isFn=false;break;}seen.set(x,y);}
      reason=isFn?'Every input x is paired with only one output y.':'At least one input x is paired with two different outputs.';
    }
    if(isFn==null){
      const tb=(problem.tables||[])[0];
      if(tb){
        const pairs=[];
        // Common vertical table: rows each contain x,y in first two cells.
        for(const row of tb.rows||[]){const vals=(row||[]).map(c=>Number(c?.value ?? c?.text)).filter(Number.isFinite);if(vals.length>=2)pairs.push([vals[0],vals[1]]);}
        // Common horizontal table: header contains x values and first row contains f(x)/y values.
        if(pairs.length<2 && (tb.headers||[]).length>=3 && (tb.rows||[]).length){
          const xs=(tb.headers||[]).slice(1).map(Number), row=tb.rows[0]||[];
          const ys=row.slice(1).map(c=>Number(c?.value ?? c?.text));
          for(let i=0;i<Math.min(xs.length,ys.length);i++)if(Number.isFinite(xs[i])&&Number.isFinite(ys[i]))pairs.push([xs[i],ys[i]]);
        }
        if(pairs.length>=2){const seen=new Map();isFn=true;for(const [x,y] of pairs){if(seen.has(x)&&Math.abs(seen.get(x)-y)>EPS){isFn=false;break;}seen.set(x,y);}reason=isFn?'Each table input has exactly one output.':'The table repeats an input with a different output.';}
      }
    }
    if(isFn==null && (problem.graphs||[]).length===1){const pass=graphPassesLineTest(problem.graphs[0],'vertical');if(pass!=null){isFn=pass;reason=pass?'The graph passes the vertical line test.':'A vertical line intersects the graph more than once.';}}
    if(isFn==null)return null;
    const choices=problem.choices||[];
    if(choices.length){const idx=choices.findIndex(c=>isFn?/\b(?:yes|true|is a function|function)\b/i.test(c.context||'')&&!/not a function/i.test(c.context||''):/\b(?:no|false|not a function)\b/i.test(c.context||''));if(idx>=0)return choiceResult(problem,[idx],[reason,`Therefore the relation ${isFn?'is':'is not'} a function.`],{type:'relation-function'});}
    return result(isFn?'yes':'no',[reason,`Therefore the relation ${isFn?'is':'is not'} a function.`],[{label:'Function test:',formulas:[isFn?'yes':'no']}],{type:'relation-function'});
  }

  function solveLineTest(problem){
    const t=allText(problem);if(!/(vertical line test|horizontal line test|one[- ]to[- ]one|is.*function)/i.test(t))return null;const mode=choiceMode(problem);const graphs=problem.graphs||[];if(graphs.length&&problem.choices?.length===graphs.length){const wantOneToOne=/one[- ]to[- ]one|horizontal/i.test(t),axis=wantOneToOne?'horizontal':'vertical',good=[];graphs.forEach((g,i)=>{if(graphPassesLineTest(g,axis)===true)good.push(i);});if(good.length)return choiceResult(problem,mode==='single'?[good[0]]:good,[`Apply the ${wantOneToOne?'horizontal':'vertical'} line test to each graph.`,`Select the graph${good.length>1?'s':''} that pass${good.length===1?'es':''}.`],{type:'line-test',axis});}
    if(graphs.length===1&&mode==='single'&&/horizontal.*vertical|vertical.*horizontal/i.test(t)){
      const vertical=graphPassesLineTest(graphs[0],'vertical'),horizontal=graphPassesLineTest(graphs[0],'horizontal');if(vertical==null||horizontal==null)return null;
      const label=!vertical?'not a function':horizontal?'one-to-one function':'function but not one-to-one';
      const idx=(problem.choices||[]).findIndex(c=>clean(c.context).toLowerCase()===label);if(idx<0)return null;
      return choiceResult(problem,[idx],[`The graph ${vertical?'passes':'fails'} the vertical line test.`,vertical?`It ${horizontal?'passes':'fails'} the horizontal line test.`:'A repeated x-value has different y-values.',`Therefore it is ${label}.`],{type:'graph-line-tests'});
    }
    const d=firstDefinition(problem);if(d&&/one[- ]to[- ]one/i.test(t)){let one=true;const ys=[];for(let x=-5;x<=5;x+=.25){const y=ev(d.ast,{[d.variable]:x});if(!Number.isFinite(y))continue;if(ys.some(z=>Math.abs(z-y)<1e-4)){one=false;break;}ys.push(y);}const labels=(problem.choices||[]).map(c=>clean(c.context).toLowerCase());if(labels.length){const idx=labels.findIndex(s=>one?/yes|true|one[- ]to[- ]one/.test(s):/no|false|not/.test(s));if(idx>=0)return choiceResult(problem,[idx],[`Apply the horizontal line test.`,`The function is ${one?'one-to-one':'not one-to-one'}.`],{type:'one-to-one'});}return result(one?'yes':'no',[`Apply the horizontal line test.`,`The function is ${one?'one-to-one':'not one-to-one'}.`],[{label:'Result:',formulas:[one?'one-to-one':'not one-to-one']}],{type:'one-to-one'});}
    return null;
  }
  function solveInverseFunction(problem){
    const t=allText(problem);if(!/(find|determine).*inverse|f\s*\^\s*\(?-1\)?/i.test(t))return null;const d=firstDefinition(problem);if(!d)return null;
    // inverse value f^-1(a)
    let mv=t.match(/f\s*\^\s*\(?-1\)?\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*\)/i);if(mv){const y=Number(mv[1]);let sols=[];const c=polyCoeffs(d.ast,d.variable);if(c){const cc=c.slice();cc[0]=(cc[0]||0)-y;sols=rootsPoly(cc)||[];}if(!sols.length){let prevX=-100,prev=ev(d.ast,{[d.variable]:prevX})-y;for(let x=-99.75;x<=100;x+=.25){const cur=ev(d.ast,{[d.variable]:x})-y;if(Number.isFinite(prev)&&Number.isFinite(cur)&&prev*cur<=0){let lo=prevX,hi=x;for(let k=0;k<60;k++){const mid=(lo+hi)/2,mm=ev(d.ast,{[d.variable]:mid})-y;if((ev(d.ast,{[d.variable]:lo})-y)*mm<=0)hi=mid;else lo=mid;}sols.push((lo+hi)/2);break;}prevX=x;prev=cur;}}
      if(sols.length){const e=answerNum(sols[0]);return result(e,[`f^(-1)(${fmt(y)}) asks for the input whose f-value is ${fmt(y)}.`,`Solve f(x)=${fmt(y)}.`,`The input is ${e}.`],[{label:'Inverse value:',formulas:[`f^(-1)(${fmt(y)})=${e}`]}],{type:'inverse-value'});}}
    const lc=linearCoeffs(d.ast,d.variable);if(lc&&Math.abs(lc.a)>EPS){const a=answerNum(lc.a),b=answerNum(lc.b);const e=`(x${lc.b>=0?'-':'+'}${answerNum(Math.abs(lc.b))})/${a}`;return result(e,[`Write y=${d.expr}.`,`Swap x and y.`,`Solve for y to obtain ${e}.`],[{label:'Inverse:',formulas:[`f^(-1)(x)=${e}`]}],{type:'inverse-linear'});}
    if(d.ast?.t==='bin'&&d.ast.o==='/'){
      const n=linearCoeffs(d.ast.a,d.variable),den=linearCoeffs(d.ast.b,d.variable);
      if(n&&den){
        const det=n.a*den.b-n.b*den.a;if(Math.abs(det)<EPS)return null;
        const e=`(${answerNum(n.b)}${den.b>=0?'-':'+'}${answerNum(Math.abs(den.b))}*x)/(${answerNum(den.a)}*x${n.a>=0?'-':'+'}${answerNum(Math.abs(n.a))})`;
        let inverseAst;try{inverseAst=parse(e);}catch(_){return null;}
        let checked=0;
        for(const x of [-3,-1,0,2]){
          const y=ev(d.ast,{[d.variable]:x}),back=ev(inverseAst,{x:y});
          if(!Number.isFinite(y)||!Number.isFinite(back))continue;
          checked++;
          if(Math.abs(back-x)>1e-7)return null;
        }
        if(checked<2)return null;
        const numerator=`${answerNum(n.a)}*x${n.b>=0?'+':''}${answerNum(n.b)}`;
        const denominator=`${answerNum(den.a)}*x${den.b>=0?'+':''}${answerNum(den.b)}`;
        const grouped=`${answerNum(den.a)}*x*y${den.b>=0?'+':''}${answerNum(den.b)}*y=${numerator}`;
        const xTerms=`${answerNum(den.a)}*x*y-${answerNum(n.a)}*x=${answerNum(n.b)}${den.b>=0?'-':'+'}${answerNum(Math.abs(den.b))}*y`;
        const factored=`x*(${answerNum(den.a)}*y-${answerNum(n.a)})=${answerNum(n.b)}${den.b>=0?'-':'+'}${answerNum(Math.abs(den.b))}*y`;
        const inverseY=e.replace(/x/g,'y');
        const teaching=[
          {explanation:'Call the output y and write the original function.',math:[`y=(${numerator})/(${denominator})`]},
          {explanation:'Multiply both sides by the denominator.',math:[`y*(${denominator})=${numerator}`]},
          {explanation:'Distribute y through the parentheses.',math:[grouped]},
          {explanation:'Move every term containing x to the left.',math:[xTerms]},
          {explanation:'Factor out x.',math:[factored]},
          {explanation:'Divide to isolate x.',math:[`x=${inverseY}`]},
          {explanation:'Rename the input y as x to state the inverse.',math:[`f^(-1)(x)=${e}`]}
        ];
        return result(e,teaching.map(s=>s.explanation),teaching.map(s=>({label:s.explanation,formulas:s.math})),{type:'inverse-rational'},{solution:{steps:teaching},verification:{ok:true,method:'composition',detail:`The serialized inverse expression was composed with the original function at ${checked} test inputs.`}});
      }
    }
    return null;
  }

  // ---------- 1.5 Exponential / logarithmic supplemental ----------
  function solveExpLogEvaluation(problem){
    const t=allText(problem);if(!/(evaluate|simplify|value)/i.test(t))return null;
    const s=sources(problem).find(x=>/(?:ln|log|\^)/i.test(x)&&!/f\s*\(/i.test(x));if(!s)return null;try{const ast=parse(s.replace(/=.*$/,''));const v=ev(ast,{});if(!Number.isFinite(v))return null;const e=exactSurd(v);return result(e,[`Evaluate the exponential/logarithmic expression using inverse properties and exact values when possible.`,`The value is ${e}.`],[{label:'Value:',formulas:[e]}],{type:'exp-log-eval'});}catch(_){return null;}
  }

  function logTermText(fn,arg,coeff=1){const inside=astText(arg);if(!inside)return null;const coreTxt=`${fn}(${inside})`;if(Math.abs(coeff-1)<EPS)return coreTxt;if(Math.abs(coeff+1)<EPS)return `-${coreTxt}`;return `${answerNum(coeff)}*${coreTxt}`;}
  function expandLogArgument(fn,arg,sign=1,out=[]){
    if(arg?.t==='bin'&&arg.o==='*'){expandLogArgument(fn,arg.a,sign,out);expandLogArgument(fn,arg.b,sign,out);return out;}
    if(arg?.t==='bin'&&arg.o==='/'){expandLogArgument(fn,arg.a,sign,out);expandLogArgument(fn,arg.b,-sign,out);return out;}
    if(arg?.t==='bin'&&arg.o==='^'){const p=ev(arg.b,{});if(Number.isFinite(p)){out.push({coeff:sign*p,arg:arg.a});return out;}}
    out.push({coeff:sign,arg});return out;
  }
  function solveLogProperties(problem){
    const t=allText(problem);if(!/(expand|write.*sum|write.*difference|logarithm.*properties|properties.*logarithm)/i.test(t))return null;
    for(const src of sources(problem)){
      let ast;try{ast=parse(src.replace(/^[^=]*=\s*/,''));}catch(_){continue;}
      if(ast?.t!=='fn'||!['ln','log'].includes(ast.n))continue;
      const terms=expandLogArgument(ast.n,ast.a);if(terms.length<2&&!terms.some(z=>Math.abs(z.coeff-1)>EPS))continue;
      const chunks=[];for(const term of terms){const txt=logTermText(ast.n,term.arg,Math.abs(term.coeff));if(!txt)return null;const neg=term.coeff<0;if(!chunks.length)chunks.push(neg?`-${txt}`:txt);else chunks.push(`${neg?' - ':' + '}${txt}`);}
      const e=chunks.join('');return result(e,['Use the product rule to turn products into sums.','Use the quotient rule to turn division into subtraction.','Use the power rule to move exponents in front of the logarithm.'],[{label:'Expanded logarithm:',formulas:[e]}],{type:'log-expand'});
    }
    return null;
  }

  function numericCoefficient(ast){
    if(!ast)return null;
    if(ast.t==='num')return {value:ast.v,text:answerNum(ast.v)};
    if(ast.t==='un'&&ast.o==='-'){
      const inner=numericCoefficient(ast.a);return inner?{value:-inner.value,text:`-${inner.text}`} : null;
    }
    if(ast.t==='bin'&&['/','*'].includes(ast.o)){
      const value=ev(ast,{});if(!Number.isFinite(value))return null;
      return {value,text:astText(ast)};
    }
    return null;
  }
  function collectLogTerms(ast,sign=1,out=[]){
    if(ast?.t==='bin'&&(ast.o==='+'||ast.o==='-')){
      collectLogTerms(ast.a,sign,out);collectLogTerms(ast.b,ast.o==='+'?sign:-sign,out);return out;
    }
    if(ast?.t==='fn'&&['ln','log'].includes(ast.n)){out.push({fn:ast.n,arg:ast.a,coefficient:{value:sign,text:answerNum(sign)}});return out;}
    if(ast?.t==='bin'&&ast.o==='*'){
      const left=numericCoefficient(ast.a),right=numericCoefficient(ast.b);
      if(left&&ast.b?.t==='fn'&&['ln','log'].includes(ast.b.n)){out.push({fn:ast.b.n,arg:ast.b.a,coefficient:{value:sign*left.value,text:sign<0?`-(${left.text})`:left.text}});return out;}
      if(right&&ast.a?.t==='fn'&&['ln','log'].includes(ast.a.n)){out.push({fn:ast.a.n,arg:ast.a.a,coefficient:{value:sign*right.value,text:sign<0?`-(${right.text})`:right.text}});return out;}
    }
    out.invalid=true;return out;
  }
  function factorForLogTerm(term){
    const arg=astText(term.arg);if(!arg)return null;
    const mag=Math.abs(term.coefficient.value);if(Math.abs(mag-1)<EPS)return vars(term.arg).size>0&&term.arg.t==='bin'?`(${arg})`:arg;
    const coeffText=answerNum(mag);
    return `${term.arg.t==='bin'?`(${arg})`:arg}^${coeffText.includes('/')?`(${coeffText})`:coeffText}`;
  }
  function expectsLogArgumentOnly(problem,fn){
    const answer=nonChoiceAnswers(problem)[0]||{};
    const ctx=clean(answer.context||'');
    return /\bA\s*=\s*$/i.test(ctx)||new RegExp(`${fn}\\s*\\(\\s*(?:\\)|$)`,'i').test(ctx)||new RegExp(`${fn}\\s+A\\b`,'i').test(allText(problem));
  }
  function solveLogCondensation(problem){
    const text=allText(problem);
    if(!/(single\s+logarithm|condens|one\s+logarithm)/i.test(text))return null;
    for(const src of sources(problem)){
      const normalized=src.replace(/\\/g,'').replace(/\b(ln|log)\s+([0-9]+(?:\.[0-9]+)?|[a-z])\b/gi,'$1($2)');
      let ast;try{ast=parse(normalized);}catch(_){continue;}
      const terms=collectLogTerms(ast);if(terms.invalid||terms.length<2)continue;
      const fn=terms[0].fn;if(terms.some(t=>t.fn!==fn))continue;
      const numerator=[],denominator=[];
      for(const term of terms){const factor=factorForLogTerm(term);if(!factor)return null;(term.coefficient.value<0?denominator:numerator).push(factor);}
      if(!numerator.length)return null;
      const product=xs=>xs.length===1?xs[0]:xs.join('*');
      const num=product(numerator),den=product(denominator);
      const argument=denominator.length?`${num}/${den}`:num;
      const full=`${fn}(${argument})`,entry=expectsLogArgumentOnly(problem,fn)?argument:full;
      const powerSteps=terms.filter(t=>Math.abs(Math.abs(t.coefficient.value)-1)>EPS).map(t=>`${answerNum(Math.abs(t.coefficient.value))}*${fn}(${astText(t.arg)}) = ${fn}(${factorForLogTerm({...t,coefficient:{...t.coefficient,value:Math.abs(t.coefficient.value)}})})`);
      const steps=[
        'Apply the power rule to move each coefficient into its logarithm as an exponent.',
        'Use the product rule for added logarithms and the quotient rule for subtracted logarithms.',
        expectsLogArgumentOnly(problem,fn)?`The page already supplies ${fn}(A), so enter only A=${argument}.`:`The single logarithm is ${full}.`
      ];
      return result(entry,steps,[
        {label:'Apply the power rule:',formulas:powerSteps.length?powerSteps:[astText(ast)]},
        {label:'Combine products and quotients:',formulas:[full]},
        {label:'Enter in this answer blank:',formulas:[entry]}
      ],{type:'log-condensation'}, {
        exactAnswers:[entry],decimalAnswers:[],
        verification:{ok:true,method:'log-ast-transform',detail:'The output is built from the parsed sum using the power, product, and quotient identities.'}
      });
    }
    return null;
  }

  // ---------- 2.1 Tangent / velocity ----------
  function findPositionDef(problem){
    const defs=parseNamedDefinitions(problem);for(const k of ['s','p','d','x'])if(defs[k])return defs[k];return Object.values(defs).find(d=>['t'].includes(d.variable))||null;
  }
  function solveVelocity(problem){
    const t=allText(problem);if(!/velocity|instantaneous\s+rate\s+of\s+change/i.test(t))return null;const d=/instantaneous\s+rate\s+of\s+change/i.test(t)?firstDefinition(problem):findPositionDef(problem);if(!d)return null;
    if(/average\s+velocity/i.test(t)){
      const intervals=[...t.matchAll(/\[\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\]/g)].map(m=>[Number(m[1]),Number(m[2])]);
      if(intervals.length){const dp=decimalPlacesFromPrompt(t);const entries=[];for(const [a,b] of intervals){const va=ev(d.ast,{[d.variable]:a}),vb=ev(d.ast,{[d.variable]:b});if(![va,vb].every(Number.isFinite)||Math.abs(b-a)<EPS)return null;const v=(vb-va)/(b-a);entries.push(dp==null?answerNum(v):v.toFixed(dp));}return multi(entries,['For each interval [a,b], use average velocity (h(b)-h(a))/(b-a).','Evaluate the height at both endpoints and divide the change in height by the elapsed time.','Round each result as requested.'],[{label:'Average velocities:',formulas:intervals.map(([a,b],i)=>`[${fmt(a)},${fmt(b)}]: ${entries[i]}`)}],{type:'average-velocity-multi'});}
    }
    let m=t.match(/average\s+velocity[\s\S]*?(?:from|between)\s*t?\s*=*\s*([+-]?\d+(?:\.\d+)?)\s*(?:to|and)\s*t?\s*=*\s*([+-]?\d+(?:\.\d+)?)/i);
    if(m){const a=Number(m[1]),b=Number(m[2]),sa=ev(d.ast,{[d.variable]:a}),sb=ev(d.ast,{[d.variable]:b});if([sa,sb].every(Number.isFinite)&&Math.abs(b-a)>EPS){const v=(sb-sa)/(b-a),e=answerNum(v);return result(e,[`Average velocity = (s(${fmt(b)})-s(${fmt(a)}))/(${fmt(b)}-${fmt(a)}).`,`Substitute the position values and simplify to ${e}.`],[{label:'Average velocity:',formulas:[e]}],{type:'average-velocity'});}}
    m=t.match(/instantaneous\s+(?:velocity|rate\s+of\s+change)[\s\S]*?(?:at|when|point:?)[\s]*[a-z]?\s*=\s*([+-]?\d+(?:\.\d+)?)/i);if(m){const a=Number(m[1]),dd=simp(deriv(d.ast,d.variable)),v=ev(dd,{[d.variable]:a});if(Number.isFinite(v)){const dp=decimalPlacesFromPrompt(t),e=dp==null?answerNum(v):v.toFixed(dp);return result(e,[`Instantaneous rate of change is the derivative ${d.name}'(${d.variable}).`,`Differentiate: ${d.name}'(${d.variable})=${astText(dd)}.`,`Evaluate at ${d.variable}=${fmt(a)} to get ${e}.`],[{label:'Derivative:',formulas:[`${d.name}'(${d.variable})=${astText(dd)}`]},{label:'Instantaneous rate:',formulas:[`${d.name}'(${fmt(a)})=${e}`]}],{type:'instantaneous-velocity'});}}
    return null;
  }
  function solveDifferenceQuotient(problem){
    const t=allText(problem);if(!/(difference quotient|f\s*\(\s*x\s*\+\s*h\s*\)\s*-\s*f\s*\(\s*x\s*\))/i.test(t))return null;const d=firstDefinition(problem);if(!d)return null;
    const c=polyCoeffs(d.ast,d.variable);
    if(c&&c.length<=9){
      const choose=(n,k)=>{let z=1;for(let i=1;i<=k;i++)z=z*(n-k+i)/i;return z;};
      const terms=[];
      for(let i=1;i<c.length;i++)if(Math.abs(c[i])>EPS){for(let j=1;j<=i;j++){const coef=c[i]*choose(i,j);if(Math.abs(coef)<EPS)continue;const xp=i-j,hp=j-1;let fac=[];if(xp>0)fac.push(xp===1?'x':`x^${xp}`);if(hp>0)fac.push(hp===1?'h':`h^${hp}`);const abs=Math.abs(coef);let body=fac.join('*');if(!body||Math.abs(abs-1)>EPS)body=`${answerNum(abs)}${body?'*'+body:''}`;terms.push({sign:Math.sign(coef),body,coef,xp,hp});}}
      let e='';for(const z of terms){if(!e)e=(z.sign<0?'-':'')+z.body;else e+=(z.sign<0?'-':'+')+z.body;}
      if(e){
        const shifted=[];
        for(let i=c.length-1;i>=0;i--)if(Math.abs(c[i])>EPS){for(let j=0;j<=i;j++){const coef=c[i]*choose(i,j);if(Math.abs(coef)<EPS)continue;const xp=i-j,hp=j;let fac=[];if(xp>0)fac.push(xp===1?d.variable:`${d.variable}^${xp}`);if(hp>0)fac.push(hp===1?'h':`h^${hp}`);const abs=Math.abs(coef);let body=fac.join('*');if(!body||Math.abs(abs-1)>EPS)body=`${answerNum(abs)}${body?'*'+body:''}`;shifted.push({sign:Math.sign(coef),body});}}
        let fxh='';for(const z of shifted){if(!fxh)fxh=(z.sign<0?'-':'')+z.body;else fxh+=(z.sign<0?'-':'+')+z.body;}
        const asksQuotient=/\(\s*f\s*\(\s*x\s*\+\s*h\s*\)\s*-\s*f\s*\(\s*x\s*\)\s*\)\s*\/\s*h|difference quotient/i.test(t);
        let difference='';for(const z of terms){const fac=[];if(z.xp>0)fac.push(z.xp===1?d.variable:`${d.variable}^${z.xp}`);const power=z.hp+1;fac.push(power===1?'h':`h^${power}`);const mag=Math.abs(z.coef);const body=`${Math.abs(mag-1)>EPS?`${answerNum(mag)}*`:''}${fac.join('*')}`;difference+=`${difference?(z.sign<0?'-':'+'):(z.sign<0?'-':'')}${body}`;}
        const second=asksQuotient?e:difference;
        const steps=[`Replace every ${d.variable} in f(${d.variable}) with ${d.variable}+h.`,`Expand to get f(${d.variable}+h)=${fxh}.`,`Subtract f(${d.variable}); matching terms cancel to give ${difference}.`,...(asksQuotient?[`Divide by h to get ${e}.`]:[])];
        const rich=[{label:`Expanded f(${d.variable}+h):`,formulas:[fxh]},{label:asksQuotient?'Difference quotient:':'Difference:',formulas:[second]}];
        if(nonChoiceAnswers(problem).length>=2&&/f\s*\(\s*x\s*\+\s*h\s*\)\s*=/i.test(t))return multi([fxh,second],steps,rich,{type:'difference-quotient-multi'});
        return result(e,steps,rich,{type:'difference-quotient'});
      }
    }
    let h={t:'var',n:'h'},x={t:'var',n:d.variable};const fxh=subst(d.ast,d.variable,{t:'bin',o:'+',a:x,b:h});const nume=simp({t:'bin',o:'-',a:fxh,b:d.ast});const q=simp({t:'bin',o:'/',a:nume,b:h});let e=astText(q);if(!e)return null;return result(e,[`Compute f(x+h) by replacing every x with x+h.`,`Subtract f(x).`,`Divide by h and simplify.`],[{label:'Difference quotient:',formulas:[e]}],{type:'difference-quotient'});
  }

  // ---------- 2.3 method-aware algebraic limits ----------
  function parseLimitRaw(text){
    const s=clean(text).replace(/\brarr\b|\barrow\b|\bto\b/g,'->');const m=s.match(/lim_?\(\s*([A-Za-z])\s*->\s*([+-]?\d+(?:\.\d+)?)\s*\)\s*([^=\n]+)/i);if(!m)return null;return {v:m[1],a:Number(m[2]),expr:clean(m[3]).replace(/[.,;]+$/,'').trim()};
  }
  function solveFactorCancelLimit(problem){
    if(!/lim|limit/i.test(allText(problem)))return null;const spec=parseLimitRaw(allText(problem));if(!spec)return null;let ast;try{ast=parse(spec.expr);}catch(_){return null;}if(ast.t!=='bin'||ast.o!=='/')return null;const nC=polyCoeffs(ast.a,spec.v),dC=polyCoeffs(ast.b,spec.v);if(!nC||!dC)return null;const nv=polyEval(nC,spec.a),dv=polyEval(dC,spec.a);if(Math.abs(nv)>1e-8||Math.abs(dv)>1e-8)return null;const nq=polyDivideLinear(nC,spec.a),dq=polyDivideLinear(dC,spec.a);if(!nq||!dq||Math.abs(nq.rem)>1e-6||Math.abs(dq.rem)>1e-6)return null;const den=polyEval(dq.q,spec.a);if(Math.abs(den)<EPS)return null;const val=polyEval(nq.q,spec.a)/den,e=answerNum(val);return result(e,[`Direct substitution gives 0/0, so factor out the common factor (${spec.v}-${answerNum(spec.a)}).`,`Cancel that common factor for ${spec.v} != ${answerNum(spec.a)}.`,`Substitute ${spec.v}=${answerNum(spec.a)} into the simplified expression to get ${e}.`],[{label:'After canceling:',formulas:[`limit=${e}`]}],{type:'factor-cancel-limit'});
  }
  function solveRadicalLimit(problem){
    const t=allText(problem);if(!/lim|limit/i.test(t)||!/sqrt/i.test(t))return null;const spec=parseLimitRaw(t);if(!spec)return null;
    // (sqrt(Ax+B)-C)/(x-a)
    const re=new RegExp(`\\(?(?:sqrt\\(\\s*([+-]?\\d+(?:\\.\\d+)?)?\\s*\\*?${spec.v}\\s*([+-]\\s*\\d+(?:\\.\\d+)?)?\\s*\\)|sqrt\\(\\s*([+-]?\\d+(?:\\.\\d+)?)?${spec.v}\\s*([+-]\\s*\\d+(?:\\.\\d+)?)?\\s*\\))\\s*-\\s*([+-]?\\d+(?:\\.\\d+)?)`,'i');
    const m=spec.expr.match(re);if(!m)return null;const A=Number((m[1]||m[3]||'1').replace(/\s/g,'')),B=Number((m[2]||m[4]||'0').replace(/\s/g,'')),C=Number(m[5]);const rad=A*spec.a+B;if(rad<0||Math.abs(Math.sqrt(rad)-C)>1e-5)return null;const val=A/(2*C),e=answerNum(val);return result(e,[`Direct substitution gives 0/0.`,`Multiply numerator and denominator by the conjugate.`,`The radicals cancel, leaving a factor that cancels with (${spec.v}-${answerNum(spec.a)}).`,`Substitute ${spec.v}=${answerNum(spec.a)} to get ${e}.`],[{label:'Rationalized limit:',formulas:[e]}],{type:'rationalize-limit'});
  }

  // ---------- 2.4 epsilon-delta ----------
  function solveEpsilonDeltaConcept(problem){
    const t=allText(problem);if(!/(epsilon|\beps\b|ε|delta|δ|0\s*<\s*\|?x)/i.test(t))return null;const choices=problem.choices||[];
    if(choices.length){const good=[];for(let i=0;i<choices.length;i++){const c=clean(choices[i].context).toLowerCase();let ok=false;
      if(/0\s*<.*x.*a.*delta|x.*within.*delta|distance.*x.*a.*less.*delta|x.*(?:is|stays).*close.*a/.test(c))ok=true;
      if(/f\(x\).*within.*epsilon|distance.*f\(x\).*l.*less.*epsilon|f\(x\).*(?:is|stays).*close.*l/.test(c))ok=true;
      if(/for every.*epsilon.*there exists.*delta|given.*epsilon.*choose.*delta/.test(c))ok=true;
      if(ok)good.push(i);
    }if(good.length)return choiceResult(problem,choiceMode(problem)==='single'?[good[0]]:good,['Use the formal definition: for every epsilon>0 there is a delta>0 such that 0<|x-a|<delta implies |f(x)-L|<epsilon.'],{type:'epsilon-delta-concept'});}
    return null;
  }
  function solveLinearDelta(problem){
    const t=allText(problem);if(!/(epsilon|ε)/i.test(t)||!/(find|choose|determine).*delta/i.test(t))return null;const d=firstDefinition(problem);if(!d)return null;const lc=linearCoeffs(d.ast,d.variable);if(!lc||Math.abs(lc.a)<EPS)return null;let eps='epsilon';const em=t.match(/epsilon\s*=\s*([0-9.]+)/i);if(em)eps=em[1];let e;if(eps==='epsilon')e=Math.abs(lc.a)===1?'epsilon':`epsilon/${answerNum(Math.abs(lc.a))}`;else e=answerNum(Number(eps)/Math.abs(lc.a));return result(e,[`For a linear function, |f(x)-L|=|${answerNum(lc.a)}| |x-a|.`,`To make this less than epsilon, require |x-a| < epsilon/|${answerNum(lc.a)}|.`,`Choose delta=${e}.`],[{label:'Delta:',formulas:[`delta=${e}`]}],{type:'epsilon-delta-linear'});
  }
  function solveInfiniteLimitDefinition(problem){
    const t=allText(problem);if(!/(precise definition|infinite limit|positive infinity|negative infinity)/i.test(t)||choiceMode(problem)==='none')return null;const sign=/negative infinity|-oo/i.test(t)?-1:1;const good=[];
    (problem.choices||[]).forEach((c,i)=>{const s=clean(c.context).toLowerCase();const near=/0\s*<.*x.*a.*delta|x.*close|within.*delta/.test(s);const bound=sign>0?/(f\(x\).*greater|f\(x\)\s*>\s*m|above.*m)/.test(s):/(f\(x\).*less|f\(x\)\s*<\s*-?m|below.*-?m)/.test(s);if(near&&bound)good.push(i);});if(!good.length)return null;return choiceResult(problem,choiceMode(problem)==='single'?[good[0]]:good,[sign>0?'For a +infinity limit, f(x) must exceed every positive bound M when x is sufficiently close to a.':'For a -infinity limit, f(x) must fall below every negative bound -M when x is sufficiently close to a.'],{type:'infinite-limit-definition'});
  }


  // ---------- corpus-hardened Chapter 1 / 2.1-2.4 solvers ----------
  function decimalPlacesFromPrompt(t){
    let m=t.match(/(\d+)\s+decimal/i);if(m)return Number(m[1]);
    const words={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};m=t.toLowerCase().match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+decimal/);return m?words[m[1]]:null;
  }
  function solveExpLogEquationCourse(problem){
    const t=allText(problem);if(!/solve/i.test(t)||!/x/i.test(t))return null;
    let m=t.match(/([0-9.]+)\s*\^\s*\(?\s*x\s*\)?\s*=\s*([0-9.]+)/i);
    if(m){
      const A=Number(m[1]),C=Number(m[2]);
      if(A>0&&A!==1&&C>0){
        const exact=`ln(${fmt(C)})/ln(${fmt(A)})`,value=Math.log(C)/Math.log(A),dp=decimalPlacesFromPrompt(t)??4,decimal=value.toFixed(dp);
        const fields=nonChoiceAnswers(problem);
        const mapped=fields.map((field,i)=>/approx|decimal|round|number/i.test(clean(field.context||''))||String(field.dataMq||field.type).toLowerCase()==='number'?decimal:(/exact|logarithm/i.test(clean(field.context||''))?exact:(i===0?exact:decimal)));
        const entries=mapped.length>1?mapped:[/approx|decimal|round/i.test(t)&&!/exact/i.test(t)?decimal:exact];
        const ok=Math.abs(Math.pow(A,value)-C)<=1e-9*Math.max(1,C);
        return multi(entries,[
          `Take a logarithm of both sides: ln(${fmt(A)}^x)=ln(${fmt(C)}).`,
          `Use the power rule: x*ln(${fmt(A)})=ln(${fmt(C)}).`,
          `Divide by ln(${fmt(A)}): x=${exact}.`,
          `Approximate and round to ${dp} decimal places: x≈${decimal}.`
        ],[
          {label:'Take logarithms:',formulas:[`ln(${fmt(A)}^x)=ln(${fmt(C)})`]},
          {label:'Use the power rule:',formulas:[`x*ln(${fmt(A)})=ln(${fmt(C)})`]},
          {label:'Solve exactly:',formulas:[`x=${exact}`]},
          {label:'Approximate:',formulas:[`x=${decimal}`]}
        ],{type:'exp-equation-exact-decimal'},{exactAnswers:[exact],decimalAnswers:[decimal],verification:{ok,method:'substitution',detail:`${fmt(A)}^(${exact})=${fmt(C)}`}});
      }
    }
    m=t.match(/([0-9.]+)\s*\^\s*\(?\s*x\s*\/\s*([0-9.]+)\s*\)?\s*=\s*([0-9.]+)/i);
    if(m){const A=Number(m[1]),B=Number(m[2]),C=Number(m[3]);if(A>0&&A!==1&&B!==0&&C>0){const val=B*Math.log(C)/Math.log(A),e=answerNum(val),entry=`${fmt(B)}*ln(${fmt(C)})/ln(${fmt(A)})`;return result(entry,[`Take ln of both sides: (x/${fmt(B)})ln(${fmt(A)})=ln(${fmt(C)}).`,`Multiply by ${fmt(B)} and divide by ln(${fmt(A)}).`,`x=${entry}${e!==entry?` ≈ ${e}`:''}.`],[{label:'Solution:',formulas:[`x=${entry}`]}],{type:'exp-equation-course'});}}
    m=t.match(/([+-]?\d+(?:\.\d+)?)\s*ln\s*\(\s*([+-]?\d*)\s*x\s*([+-]\s*\d+(?:\.\d+)?)?\s*\)\s*=\s*([+-]?\d+(?:\.\d+)?)/i);
    if(m){const k=Number(m[1]),a=Number(m[2]||1),b=Number(String(m[3]||0).replace(/\s/g,'')),rhs=Number(m[4]);if(Math.abs(k)>EPS&&Math.abs(a)>EPS){const exponent=rhs/k,value=(Math.exp(exponent)-b)/a,dp=decimalPlacesFromPrompt(t),e=dp!=null?value.toFixed(dp):answerNum(value);return result(e,[`Divide by ${fmt(k)}: ln(${fmt(a)}x${b>=0?'+':''}${fmt(b)})=${answerNum(exponent)}.`,`Exponentiate: ${fmt(a)}x${b>=0?'+':''}${fmt(b)}=e^(${answerNum(exponent)}).`,`Solve for x and round as requested: x=${e}.`],[{label:'Solution:',formulas:[`x=${e}`]}],{type:'scaled-log-equation'},{verification:{ok:Math.abs(k*Math.log(a*value+b)-rhs)<1e-7,method:'substitution',detail:'Substitution into the original logarithmic equation.'}});}}
    m=t.match(/ln\s*\(\s*([+-]?[0-9.]*)\s*x\s*([+-]\s*[0-9.]+)?\s*\)\s*([+-]\s*[0-9.]+)?\s*=\s*([+-]?[0-9.]+)/i);
    if(m){const a=Number(m[1]||1),b=Number(String(m[2]||0).replace(/\s/g,'')),c=Number(String(m[3]||0).replace(/\s/g,'')),rhs=Number(m[4]);if(Math.abs(a)>EPS){const val=(Math.exp(rhs-c)-b)/a;const dp=decimalPlacesFromPrompt(t);const e=dp!=null?val.toFixed(dp):answerNum(val);return result(e,[`Isolate the logarithm: ln(${fmt(a)}x${b>=0?'+':''}${fmt(b)})=${fmt(rhs-c)}.`,`Exponentiate both sides: ${fmt(a)}x${b>=0?'+':''}${fmt(b)}=e^(${fmt(rhs-c)}).`,`Solve for x to get ${e}.`],[{label:'Solution:',formulas:[`x=${e}`]}],{type:'log-equation-course'});}}
    return null;
  }
  function solveContinuityParameterCourse(problem){
    const t=allText(problem);if(!/continuous\s+everywhere|make.*continuous/i.test(t)||!/[A-Za-z]\s*=\s*$|then\s+we\s+must\s+have/i.test(t))return null;
    const pieces=[...t.matchAll(/\(\s*([^,]+),\s*"if",\s*x\s*(<|>|<=|>=|leq|geq)\s*([+-]?\d+(?:\.\d+)?)\s*\)/gi)];if(pieces.length<2)return null;
    const a=Number(pieces[0][3]);const pieceExpr=r=>{let z=clean(r);if(z.includes('='))z=z.slice(z.lastIndexOf('=')+1);return z.replace(/^[\s(]+/,'').replace(/[\s)]+$/,'').trim();};const p1=pieceExpr(pieces[0][1]),p2=pieceExpr(pieces[1][1]);let A1,B1,A2,B2;
    try{const e1=parse(p1),e2=parse(p2);const v10=ev(e1,{x:a,m:0,c:0,k:0}),v11=ev(e1,{x:a,m:1,c:1,k:1});const v20=ev(e2,{x:a,m:0,c:0,k:0}),v21=ev(e2,{x:a,m:1,c:1,k:1});A1=v11-v10;B1=v10;A2=v21-v20;B2=v20;}catch(_){return null;}
    const coeff=A1-A2, rhs=B2-B1;if(Math.abs(coeff)<EPS)return null;const val=rhs/coeff,e=answerNum(val);return result(e,[`Continuity at x=${fmt(a)} requires the left- and right-hand formulas to agree.`,`Set ${p1} = ${p2} at x=${fmt(a)}.`,`Solve the resulting linear equation for the parameter: ${e}.`],[{label:'Continuity parameter:',formulas:[e]}],{type:'continuity-parameter-course'});
  }
  function extractFunctionExprFromText(t){
    const m=t.match(/f\s*\(\s*x\s*\)\s*=\s*(.+?)(?=\s*(?:\.\s*We\s+want|We\s+want|Start\s+by|Based\s+on|$))/i);return m?clean(m[1]):null;
  }
  function numericalStableLimit(ast,v='x',a=0,side='two'){
    const hs=[1e-2,5e-3,2e-3,1e-3,5e-4,2e-4,1e-4,5e-5,2e-5,1e-5,5e-6,2e-6];
    const one=sgn=>{const vals=hs.map(h=>ev(ast,{[v]:a+sgn*h})).filter(Number.isFinite);if(vals.length<4)return null;const tail=vals.slice(-4),avg=tail.reduce((x,y)=>x+y,0)/tail.length,spread=Math.max(...tail)-Math.min(...tail);if(spread<2e-4*Math.max(1,Math.abs(avg)))return avg;return tail.at(-1);};
    const l=one(-1),r=one(1);if(side==='left')return l;if(side==='right')return r;if(l==null||r==null)return null;if(Math.abs(l-r)<1e-3*Math.max(1,Math.abs(l),Math.abs(r)))return (l+r)/2;return 'DNE';
  }
  function solveNumericalTableCourse(problem){
    const t=allText(problem);if(!/(inputs\s+listed\s+in\s+this\s+table|guess\s+the\s+value\s+of\s+the\s+limit)/i.test(t))return null;const table=(problem.tables||[])[0];if(!table?.rows?.length)return null;const expr=extractFunctionExprFromText(t);if(!expr)return null;let ast;try{ast=parse(expr);}catch(_){return null;}
    const xs=[];for(const row of table.rows){const c=row.find(cell=>Number.isFinite(cell?.value)&&!cell.answerId);if(c)xs.push(Number(c.value));}if(!xs.length)return null;const vals=xs.map(x=>ev(ast,{x}));if(vals.some(v=>!Number.isFinite(v)))return null;let lim=numericalStableLimit(ast,'x',0,'two');
    // Exact common exponential difference quotient: (e^(ax)-e^(bx))/x -> a-b.
    const em=compact(expr).match(/^\(e\^\(?([+-]?[0-9.]+)x\)?-e\^\(?([+-]?[0-9.]+)x\)?\)\/x$/i);if(em)lim=Number(em[1])-Number(em[2]);if(!Number.isFinite(lim))return null;
    const entries=[...vals.map(v=>v.toFixed(8)),answerNum(lim)];return multi(entries,['Evaluate f(x) at each listed x-value.','As x moves closer to 0, the values stabilize.',`The estimated limit is ${entries.at(-1)}.`],[{label:'Table values:',formulas:xs.map((x,i)=>`f(${fmt(x)})=${entries[i]}`)},{label:'Limit:',formulas:[entries.at(-1)]}],{type:'numerical-limit-table-course'});
  }
  function parseSideLimitSpecsFromText(t){
    const s=clean(core().rewriteTexFractions?.(t)||t).replace(/\brarr\b|\barrow\b|\bto\b/gi,'->').replace(/xarrow/gi,'x->').replace(/\\/g,' ');
    const out=[];const re=/lim_?\(\s*([A-Za-z])\s*->\s*([^\)]+?)\s*\)\s*([^=\n]+)(?==|$)/gi;let m;while((m=re.exec(s))){let target=m[2].trim(),side='two';const sm=target.match(/\^\s*([+-])\s*$/);if(sm){side=sm[1]==='+'?'right':'left';target=target.slice(0,sm.index).trim();}const expr=clean(m[3]).replace(/[.,;]+$/,'').trim();out.push({v:m[1],target,side,expr});}return out;
  }
  function parseTargetGeneral(raw){const s=compact(core().rewriteTexFractions?.(raw)||raw).replace(/^\(+|\)+$/g,'');try{return ev(parse(s),{});}catch(_){return Number(s);}}
  function solveOneSidedGenericCourse(problem){
    const t=allText(problem);const specs=parseSideLimitSpecsFromText(t);if(!specs.length)return null;const answers=nonChoiceAnswers(problem);if(answers.length>1&&specs.length!==answers.length)return null;const entries=[];const steps=[];
    for(const sp of specs){const a=parseTargetGeneral(sp.target);if(!Number.isFinite(a))return null;let expr=sp.expr.replace(/\|([^|]+)\|/g,'abs($1)');let ast;try{ast=parse(expr);}catch(_){return null;}let val=ev(ast,{[sp.v]:a});if(!Number.isFinite(val)||Math.abs(val)>1e10)val=numericalStableLimit(ast,sp.v,a,sp.side);if(val==null)return null;let e;if(val==='DNE')e='DNE';else if(!Number.isFinite(val))e=val>0?'oo':'-oo';else e=answerNum(val);entries.push(e);steps.push(`${sp.v} approaches ${sp.target}${sp.side==='right'?' from the right':sp.side==='left'?' from the left':''}; the expression approaches ${e}.`);}
    if(answers.length===1&&entries.length>1){if(!entries.every(e=>e===entries[0]))return null;const first=specs[0],a=parseTargetGeneral(first.target);let direct=NaN;try{direct=ev(parse(first.expr),{[first.v]:a});}catch(_){}const work=Number.isFinite(direct)?[`Substitute ${first.v}=${answerNum(a)} into the continuous expression.`,`Simplify the result to ${entries[0]}.`]:[`Direct substitution at ${first.v}=${answerNum(a)} is indeterminate; simplify the expression by factoring or cancellation.`,`Evaluate the simplified expression as ${first.v} approaches ${answerNum(a)} to obtain ${entries[0]}.`];return result(entries[0],work,[{label:'Limit:',formulas:[entries[0]]}],{type:'one-sided-generic-course'});}
    if(entries.length===1)return result(entries[0],steps,[{label:'Limit:',formulas:entries}],{type:'one-sided-generic-course'});return multi(entries,steps,[{label:'Limits:',formulas:entries}],{type:'one-sided-generic-course'});
  }
  function solveDirectLimitCourse(problem){
    const t=allText(problem);if(!/lim|limit/i.test(t))return null;const specs=parseSideLimitSpecsFromText(t);if(specs.length!==1)return null;const sp=specs[0],a=parseTargetGeneral(sp.target);if(!Number.isFinite(a))return null;let ast;try{ast=parse(sp.expr.replace(/\|([^|]+)\|/g,'abs($1)'));}catch(_){return null;}let v=ev(ast,{[sp.v]:a});if(Number.isFinite(v)&&Math.abs(v)<1e10){const e=answerNum(v);return result(e,[`This expression is continuous at ${sp.v}=${answerNum(a)}, so use direct substitution.`,`Substitute ${sp.v}=${answerNum(a)} and simplify to ${e}.`],[{label:'Limit:',formulas:[e]}],{type:'direct-limit-course'});}v=numericalStableLimit(ast,sp.v,a,sp.side);if(v==null)return null;const e=v==='DNE'?'DNE':!Number.isFinite(v)?(v>0?'oo':'-oo'):answerNum(v);return result(e,[`Direct substitution is indeterminate or undefined, so examine values near ${sp.v}=${answerNum(a)}.`,`The values approach ${e}.`],[{label:'Limit:',formulas:[e]}],{type:'numeric-limit-course'});
  }
  function solveStandardTrigLimitCourse(problem){
    const t=compact(allText(problem)).replace(/xarrow/g,'x->').replace(/rarr|arrow|to/g,'->');
    let m=t.match(/lim_?\(\s*([A-Za-z]+)->0\)\(?tan\(\s*([+-]?[0-9.]+)\1\s*\)\)?\/\(?\1\)?/i);if(m){const e=answerNum(Number(m[2]));return result(e,[`Rewrite tan(${m[2]}${m[1]})/${m[1]} as ${m[2]}·[tan(${m[2]}${m[1]})/(${m[2]}${m[1]})].`,`Use lim_(u->0) tan(u)/u = 1.`,`The limit is ${e}.`],[{label:'Standard trig limit:',formulas:[e]}],{type:'tan-standard-limit'});}
    m=t.match(/lim_?\(\s*([A-Za-z]+)->0\)sin\(\s*([+-]?[0-9.]+)\1\s*\)\/sin\(\s*([+-]?[0-9.]+)\1\s*\)/i);if(m){const e=rat(Number(m[2])/Number(m[3]),96,1e-10)||answerNum(Number(m[2])/Number(m[3]));return result(e,[`Multiply and divide to use sin(u)/u -> 1.`,`The limit is the ratio of the coefficients: ${m[2]}/${m[3]}=${e}.`],[{label:'Standard trig limit:',formulas:[e]}],{type:'sin-ratio-limit'});}
    return null;
  }

  function solveFracTargetRationalCourse(problem){
    const t=allText(problem);if(!/lim/i.test(t)||!/frac\s*\(/i.test(t))return null;
    const targets=[...t.matchAll(/lim_?\(\s*([A-Za-z])\s*(?:to|rarr|->)\s*frac\s*\(\s*([^\)]+)\s*\)\s*\(\s*([^\)]+)\s*\)\s*\^?\s*([+-])?\s*\)/gi)];
    if(!targets.length)return null;
    const fracs=[...t.matchAll(/frac\s*\(\s*([^\)]+)\s*\)\s*\(\s*([^\)]+)\s*\)/gi)];const fm=fracs.find(z=>/[A-Za-z]/.test(z[1]+z[2])&&!/^\s*pi\s*$/i.test(z[1]));if(!fm)return null;
    let numAst,denAst,ast;try{numAst=parse(fm[1]);denAst=parse(fm[2]);ast=parse(`(${fm[1]})/(${fm[2]})`);}catch(_){return null;}const entries=[],steps=[];
    for(const m of targets){const v=m[1],a=parseNumericArg(`(${m[2]})/(${m[3]})`),side=m[4]==='+'?'right':m[4]==='-'?'left':'two';if(!Number.isFinite(a))return null;const n0=ev(numAst,{[v]:a}),d0=ev(denAst,{[v]:a});let val;if(Number.isFinite(n0)&&Math.abs(n0)>1e-10&&Number.isFinite(d0)&&Math.abs(d0)<1e-9&&side!=='two'){const h=side==='right'?1e-7:-1e-7;const sign=Math.sign(ev(numAst,{[v]:a+h})/ev(denAst,{[v]:a+h}));val=sign>=0?Infinity:-Infinity;}else val=numericalStableLimit(ast,v,a,side);if(val==null)return null;let e;if(!Number.isFinite(val))e=val>0?'oo':'-oo';else e=answerNum(val);entries.push(e);steps.push(`As ${v} approaches ${answerNum(a)}${side==='right'?' from the right':side==='left'?' from the left':''}, the denominator approaches 0 with the corresponding sign, so the quotient approaches ${e}.`);}
    return entries.length===1?result(entries[0],steps,[{label:'Limit:',formulas:entries}],{type:'frac-target-rational'}):multi(entries,steps,[{label:'One-sided limits:',formulas:entries}],{type:'frac-target-rational'});
  }
  function solveTrigAsymptoteCourse(problem){
    const t=allText(problem);const fm=t.match(/f\s*\(x\)\s*=\s*(sec|tan|csc|cot)\s*x/i);if(!fm||!/vertical\s+asymptote/i.test(t))return null;const fn=fm[1].toLowerCase();
    const lims=[...t.matchAll(/lim_?\(\s*x\s*->\s*\(?\(?\s*([^\^\)]+(?:\)\/2)?)\s*\)?\s*\^\s*([+-])\s*\)/gi)];
    const targets=[];
    // More permissive extraction for pi/2 and (3 pi)/2 forms.
    const re=/lim_?\(\s*x\s*->\s*(\(?\(?\s*(?:\d+\s*\*?\s*)?pi\s*\)?\s*\/\s*\d+\s*\)?)\s*\^\s*([+-])\s*\)/gi;let m;while((m=re.exec(t)))targets.push({raw:m[1],side:m[2]});
    if(!targets.length)return null;const entries=[],steps=[];
    for(const q of targets){let raw=clean(q.raw).replace(/\s+/g,'');raw=raw.replace(/^\(\(([^)]+)\)\/([^)]+)\)$/,'$1/$2').replace(/^\(([^)]+)\)$/,'$1').replace(/\s/g,'');let a;try{a=parseNumericArg(raw);}catch(_){return null;}if(!Number.isFinite(a))return null;const h=q.side==='+'?1e-7:-1e-7;let val;if(fn==='sec')val=1/Math.cos(a+h);else if(fn==='tan')val=Math.tan(a+h);else if(fn==='csc')val=1/Math.sin(a+h);else val=1/Math.tan(a+h);const inf=val>0?'oo':'-oo';entries.push(inf,anglePiText(a));steps.push(`Near x=${anglePiText(a)} from the ${q.side==='+'?'right':'left'}, ${fn}(x) tends to ${inf}; x=${anglePiText(a)} is a vertical asymptote.`);}
    if(entries.length!==nonChoiceAnswers(problem).length)return null;return multi(entries,steps,[{label:'Enter limit, asymptote, limit, asymptote:',formulas:entries}],{type:'trig-asymptote-course'});
  }

  function solveSqueezeCourse(problem){
    const t=allText(problem);if(!/squeeze\s+theorem/i.test(t))return null;const lm=t.match(/lim_?\(\s*x\s*(?:rarr|->|to)\s*([+-]?\d+(?:\.\d+)?)\s*\)\s*g\s*\(x\)/i);if(!lm)return null;const a=Number(lm[1]);const ineq=t.match(/([+-]?[0-9xX^*+\-\/(). ]+?)\s*<\s*g\s*\(x\)\s*<\s*([+-]?[0-9xX^*+\-\/(). ]+)/i);if(!ineq)return null;let A,B;try{A=parse(ineq[1].trim().replace(/[.,;]+$/,''));B=parse(ineq[2].trim().replace(/[.,;]+$/,''));}catch(_){return null;}const l=ev(A,{x:a}),u=ev(B,{x:a});if(!Number.isFinite(l)||!Number.isFinite(u))return null;const e1=answerNum(l),e2=answerNum(u),e3=Math.abs(l-u)<1e-8?e1:'DNE';return multi([e1,e2,e3],[`Evaluate the lower bound at x=${fmt(a)}: ${e1}.`,`Evaluate the upper bound at x=${fmt(a)}: ${e2}.`,e1===e2?`Both bounds approach ${e1}, so the Squeeze Theorem gives the same limit for g(x).`:'The two bounds do not approach the same number.'],[{label:'Squeeze theorem:',formulas:[e1,e2,e3]}],{type:'squeeze-course'});
  }

  function solve(problem){
    const solvers=[
      solveInverseRangeDomainTF,solveIVTChoice,
      solveContinuityParameterCourse,solveExpLogEquationCourse,solveNumericalTableCourse,
      solveTrigAsymptoteCourse,solveFracTargetRationalCourse,solveSqueezeCourse,solveStandardTrigLimitCourse,solveOneSidedGenericCourse,solveDirectLimitCourse,
      solveEpsilonDeltaConcept,solveLinearDelta,solveInfiniteLimitDefinition,
      solveFactorCancelLimit,solveRadicalLimit,
      solveVelocity,solveDifferenceQuotient,solveLimitLawChoice,
      solveTrigEquationCourse,solveQuadraticTrigEquation,solveCompoundTrigExact,solveInverseTrig,solveTrigExact,solveAngleConversion,solveTrigPeriod,solveTrigIdentityChoice,
      solveInverseVerification,solveInverseFunction,solveRelationIsFunction,solveLineTest,
      solvePiecewiseDrawing,solveCommonDrawing,solveGraphDomainRange,solveTransformations,solveIntervalNotation,
      solveDomainBasic,solveRangeCommon,solveComposition,solveFunctionOperations,solveFunctionEvaluation,solveZeros,solveEvenOdd,
      solveLineQuestions,solvePiecewiseValue,solveClassifyFunction,solveLogCondensation,solveLogProperties,solveExpLogEvaluation
    ];
    for(const fn of solvers){try{const r=fn(problem);if(r?.ok)return r;}catch(_){} }
    return null;
  }
  self.MOMCourseEngine={solve,_test:{polyCoeffs,rootsPoly,linearCoeffs,parseNamedDefinitions,graphPassesLineTest,anglePiText,exactSurd}};
})();
