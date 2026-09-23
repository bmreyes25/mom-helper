(() => {
  const EPS = 1e-10;
  const FUNCTIONS = new Set(['sin','cos','tan','sec','csc','cot','asin','acos','atan','arcsin','arccos','arctan','sinh','cosh','tanh','sqrt','ln','log','exp','abs']);

  const num = v => Number.isFinite(Number(v)) ? Number(v) : null;
  const clean = s => String(s ?? '').replace(/−/g,'-').replace(/→/g,'->').replace(/∞/g,'oo').replace(/\u00a0/g,' ').trim();
  const compact = s => clean(s).replace(/\s+/g,'');
  function fmt(x, digits=10) {
    if (!Number.isFinite(x)) return x === Infinity ? 'oo' : x === -Infinity ? '-oo' : 'DNE';
    if (Math.abs(x) < 1e-12) x = 0;
    if (Math.abs(x-Math.round(x)) < 1e-10) return String(Math.round(x));
    return String(Number(x.toFixed(digits)));
  }
  function gcd(a,b){ a=Math.abs(Math.trunc(a)); b=Math.abs(Math.trunc(b)); while(b)[a,b]=[b,a%b]; return a||1; }
  function rational(x, maxDen=96, tol=1e-9){
    if(!Number.isFinite(x)) return null;
    if(Math.abs(x-Math.round(x))<tol) return String(Math.round(x));
    let best=null;
    for(let d=1;d<=maxDen;d++){ const n=Math.round(x*d), e=Math.abs(n/d-x); if(!best||e<best.e)best={n,d,e}; }
    if(!best || best.e>Math.max(tol,1e-7)) return null;
    const g=gcd(best.n,best.d); let n=best.n/g,d=best.d/g; if(d<0){n=-n;d=-d;} return d===1?String(n):`${n}/${d}`;
  }
  const answerNum = x => rational(x, 128, 1e-8) || fmt(x, 10);
  const limitAnswerNum = x => rational(x, 128, 2e-5) || fmt(x, 9);

  function rewriteTexFractions(input){
    let s=String(input??'');
    function groupAt(pos){
      while(pos<s.length && /\s/.test(s[pos]))pos++;
      const open=s[pos]; const close=open==='{'?'}':open==='('?')':null;
      if(!close)return null; let depth=0;
      for(let i=pos;i<s.length;i++){
        if(s[i]===open)depth++; else if(s[i]===close){depth--;if(depth===0)return {start:pos,end:i,body:s.slice(pos+1,i)};}
      }
      return null;
    }
    for(let guard=0;guard<30;guard++){
      const k1=s.lastIndexOf('\\frac');
      const all=[...s.matchAll(/\bfrac(?=\s*[({])/g)].filter(m=>m.index===0||s[m.index-1]!=='\\');
      const k2=all.length?all.at(-1).index:-1;
      const k=Math.max(k1,k2); if(k<0)break;
      const token=s.startsWith('\\frac',k)?'\\frac':'frac';
      const a=groupAt(k+token.length); if(!a)break;
      const b=groupAt(a.end+1); if(!b)break;
      s=s.slice(0,k)+`((${a.body})/(${b.body}))`+s.slice(b.end+1);
    }
    return s;
  }

  // ---------- expression parser ----------
  function normalizeExpr(src) {
    let s = rewriteTexFractions(clean(src))
      .replace(/\\left|\\right/g,'')
      .replace(/\\cdot|·/g,'*')
      .replace(/\\pi/g,'pi')
      .replace(/\\ln/g,'ln').replace(/\\log/g,'log')
      .replace(/\\sin/g,'sin').replace(/\\cos/g,'cos').replace(/\\tan/g,'tan')
      .replace(/\\sec/g,'sec').replace(/\\csc/g,'csc').replace(/\\cot/g,'cot')
      .replace(/\\sqrt/g,'sqrt')
      .replace(/\\(?:,|;|!| )/g,' ')
      .replace(/\|([^|]+)\|/g,'abs($1)')
      .replace(/\b(sin|cos|tan|sec|csc|cot|ln|log|sqrt)\s+([A-Za-z][A-Za-z0-9_]*)\b/g,'$1($2)')
      .replace(/\bln\s+/g,'ln')
      .replace(/[{}]/g, m => m==='{'?'(':')');
    return s;
  }

  function tokenize(src) {
    const s=normalizeExpr(src); const t=[]; let i=0;
    while(i<s.length){
      const c=s[i]; if(/\s/.test(c)){i++;continue;}
      const n=s.slice(i).match(/^(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/); if(n){t.push({k:'num',v:Number(n[0]),raw:n[0]});i+=n[0].length;continue;}
      const id=s.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/); if(id){t.push({k:'id',v:id[0]});i+=id[0].length;continue;}
      if('+-*/^(),='.includes(c)){t.push({k:c,v:c});i++;continue;}
      throw new Error(`Unsupported token ${c}`);
    }
    t.push({k:'eof'}); return t;
  }
  class Parser {
    constructor(s){this.ts=tokenize(s);this.i=0;}
    p(k){return this.ts[this.i]?.k===k;}
    take(k){const x=this.ts[this.i];if(k&&x?.k!==k)throw new Error(`Expected ${k}`);this.i++;return x;}
    parse(){const n=this.eq();if(!this.p('eof'))throw new Error('Trailing input');return n;}
    eq(){let a=this.add(); if(this.p('=')){this.take('='); return {t:'eq',a,b:this.add()};} return a;}
    add(){let a=this.mul();while(this.p('+')||this.p('-')){const o=this.take().k;a={t:'bin',o,a,b:this.mul()};}return a;}
    startsPrimary(tok=this.ts[this.i]){ return tok && (tok.k==='num'||tok.k==='id'||tok.k==='('); }
    mul(){let a=this.unary(); while(true){
      if(this.p('*')||this.p('/')){const o=this.take().k;a={t:'bin',o,a,b:this.unary()};continue;}
      // implicit multiplication: 2x, 3(x+1), x sin(x). A recognized function
      // followed by '(' is consumed in primary(), so it never lands here.
      if(this.startsPrimary()){a={t:'bin',o:'*',a,b:this.unary()};continue;}
      break;
    } return a;}
    // Exponentiation binds more tightly than a leading sign.  This matters for
    // textbook expressions such as -4^(x+5), which means -(4^(x+5)), not
    // (-4)^(x+5).  The exponent still accepts a unary sign, so x^-2 works.
    unary(){if(this.p('+')||this.p('-')){const o=this.take().k;return {t:'un',o,a:this.unary()};}return this.pow();}
    pow(){let a=this.primary();if(this.p('^')){this.take('^');a={t:'bin',o:'^',a,b:this.unary()};}return a;}
    primary(){
      if(this.p('num')) return {t:'num',v:this.take('num').v};
      if(this.p('id')){
        const name=this.take('id').v;
        if(this.p('(') && FUNCTIONS.has(name.toLowerCase())){this.take('(');const a=this.eq();this.take(')');return {t:'fn',n:name.toLowerCase(),a};}
        return {t:'var',n:name};
      }
      if(this.p('(')){this.take('(');const a=this.eq();this.take(')');return a;}
      throw new Error('Expected expression');
    }
  }
  function parseExpr(s){return new Parser(s).parse();}
  function isConst(n){if(!n)return false;if(n.t==='num')return true;if(n.t==='var')return ['pi','e'].includes(n.n.toLowerCase());if(n.t==='un')return isConst(n.a);if(n.t==='bin')return isConst(n.a)&&isConst(n.b);if(n.t==='fn')return isConst(n.a);return false;}
  function evalAst(n, env={}){
    if(!n)return NaN;
    if(n.t==='num')return n.v;
    if(n.t==='var'){
      const k=n.n; if(Object.prototype.hasOwnProperty.call(env,k))return Number(env[k]);
      if(k.toLowerCase()==='pi')return Math.PI;if(k.toLowerCase()==='e')return Math.E; return NaN;
    }
    if(n.t==='un'){const a=evalAst(n.a,env);return n.o==='-'?-a:a;}
    if(n.t==='bin'){
      const a=evalAst(n.a,env),b=evalAst(n.b,env);
      if(n.o==='+')return a+b;if(n.o==='-')return a-b;if(n.o==='*')return a*b;if(n.o==='/')return a/b;if(n.o==='^')return Math.pow(a,b);
    }
    if(n.t==='eq') return evalAst(n.a,env)-evalAst(n.b,env);
    if(n.t==='fn'){
      const a=evalAst(n.a,env); switch(n.n){
        case 'sin':return Math.sin(a);case 'cos':return Math.cos(a);case 'tan':return Math.tan(a);
        case 'sec':return 1/Math.cos(a);case 'csc':return 1/Math.sin(a);case 'cot':return 1/Math.tan(a);
        case 'asin':case 'arcsin':return Math.asin(a);case 'acos':case 'arccos':return Math.acos(a);case 'atan':case 'arctan':return Math.atan(a);
        case 'sinh':return Math.sinh(a);case 'cosh':return Math.cosh(a);case 'tanh':return Math.tanh(a);
        case 'sqrt':return Math.sqrt(a);case 'ln':return Math.log(a);case 'log':return Math.log10(a);case 'exp':return Math.exp(a);case 'abs':return Math.abs(a);
      }
    }
    return NaN;
  }
  function prec(n){if(!n)return 99;if(n.t==='eq')return 1;if(n.t==='bin')return n.o==='+'||n.o==='-'?2:n.o==='*'||n.o==='/'?3:4;if(n.t==='un')return 5;return 6;}
  function astText(n,p=0){
    if(n.t==='num')return fmt(n.v);
    if(n.t==='var')return n.n;
    if(n.t==='fn')return `${n.n}(${astText(n.a)})`;
    if(n.t==='un')return `${n.o}${astText(n.a,5)}`;
    if(n.t==='eq')return `${astText(n.a,1)}=${astText(n.b,1)}`;
    if(n.t==='bin'){
      const q=prec(n); let s;
      if(n.o==='^') s=`${astText(n.a,q)}^${astText(n.b,q)}`;
      else s=`${astText(n.a,q)}${n.o}${astText(n.b,q+(n.o==='-'||n.o==='/'?1:0))}`;
      return q<p?`(${s})`:s;
    }
    return '';
  }
  const N=v=>({t:'num',v}); const V=n=>({t:'var',n}); const B=(o,a,b)=>({t:'bin',o,a,b}); const U=(o,a)=>({t:'un',o,a}); const F=(n,a)=>({t:'fn',n,a});
  function sameNum(n,v){return n?.t==='num'&&Math.abs(n.v-v)<EPS;}
  function simplify(n){
    if(!n)return n;if(['num','var'].includes(n.t))return n;
    if(n.t==='un'){const a=simplify(n.a);if(n.o==='+' )return a;if(a.t==='num')return N(-a.v);if(a.t==='un'&&a.o==='-')return simplify(a.a);return U(n.o,a);}
    if(n.t==='fn'){const a=simplify(n.a);if(isConst(a)){const v=evalAst({t:'fn',n:n.n,a});if(Number.isFinite(v))return N(v);}return F(n.n,a);}
    if(n.t==='eq')return {t:'eq',a:simplify(n.a),b:simplify(n.b)};
    if(n.t==='bin'){
      const a=simplify(n.a),b=simplify(n.b),o=n.o;
      if(a.t==='num'&&b.t==='num'){const v=evalAst(B(o,a,b));if(Number.isFinite(v))return N(v);}
      if(o==='+'){if(sameNum(a,0))return b;if(sameNum(b,0))return a;}
      if(o==='-'){if(sameNum(b,0))return a;if(sameNum(a,0))return simplify(U('-',b));}
      if(o==='*'){if(sameNum(a,0)||sameNum(b,0))return N(0);if(sameNum(a,1))return b;if(sameNum(b,1))return a;if(sameNum(a,-1))return simplify(U('-',b));if(sameNum(b,-1))return simplify(U('-',a));}
      if(o==='/'){if(sameNum(a,0))return N(0);if(sameNum(b,1))return a;}
      if(o==='^'){if(sameNum(b,0))return N(1);if(sameNum(b,1))return a;if(sameNum(a,1))return N(1);}
      return B(o,a,b);
    }
    return n;
  }
  function derivative(n, variable='x'){
    if(n.t==='num')return N(0);
    if(n.t==='var')return N(n.n===variable?1:0);
    if(n.t==='un')return simplify(U(n.o,derivative(n.a,variable)));
    if(n.t==='bin'){
      const u=n.a,v=n.b,du=derivative(u,variable),dv=derivative(v,variable);
      if(n.o==='+')return simplify(B('+',du,dv));
      if(n.o==='-')return simplify(B('-',du,dv));
      if(n.o==='*')return simplify(B('+',B('*',du,v),B('*',u,dv)));
      if(n.o==='/')return simplify(B('/',B('-',B('*',du,v),B('*',u,dv)),B('^',v,N(2))));
      if(n.o==='^'){
        if(isConst(v)) return simplify(B('*',B('*',v,B('^',u,B('-',v,N(1)))),du));
        if(isConst(u)) return simplify(B('*',B('*',B('^',u,v),F('ln',u)),dv));
        return simplify(B('*',B('^',u,v),B('+',B('*',dv,F('ln',u)),B('*',v,B('/',du,u)))));
      }
    }
    if(n.t==='fn'){
      const u=n.a,du=derivative(u,variable); let outer;
      switch(n.n){
        case 'sin':outer=F('cos',u);break;
        case 'cos':outer=U('-',F('sin',u));break;
        case 'tan':outer=B('^',F('sec',u),N(2));break;
        case 'sec':outer=B('*',F('sec',u),F('tan',u));break;
        case 'csc':outer=U('-',B('*',F('csc',u),F('cot',u)));break;
        case 'cot':outer=U('-',B('^',F('csc',u),N(2)));break;
        case 'ln':outer=B('/',N(1),u);break;
        case 'log':outer=B('/',N(1),B('*',u,F('ln',N(10))));break;
        case 'exp':outer=F('exp',u);break;
        case 'sqrt':outer=B('/',N(1),B('*',N(2),F('sqrt',u)));break;
        case 'asin':case 'arcsin':outer=B('/',N(1),F('sqrt',B('-',N(1),B('^',u,N(2)))));break;
        case 'acos':case 'arccos':outer=U('-',B('/',N(1),F('sqrt',B('-',N(1),B('^',u,N(2))))));break;
        case 'atan':case 'arctan':outer=B('/',N(1),B('+',N(1),B('^',u,N(2))));break;
        default:return N(NaN);
      }
      return simplify(B('*',outer,du));
    }
    return N(NaN);
  }

  function integrateSimple(n, variable='x'){
    n=simplify(n);
    if(isConst(n)) return simplify(B('*',n,V(variable)));
    if(n.t==='var'&&n.n===variable)return B('/',B('^',V(variable),N(2)),N(2));
    if(n.t==='bin'&&(n.o==='+'||n.o==='-')){
      const a=integrateSimple(n.a,variable),b=integrateSimple(n.b,variable);if(a&&b)return simplify(B(n.o,a,b));
    }
    if(n.t==='bin'&&n.o==='*'){
      if(isConst(n.a)){const b=integrateSimple(n.b,variable);if(b)return simplify(B('*',n.a,b));}
      if(isConst(n.b)){const a=integrateSimple(n.a,variable);if(a)return simplify(B('*',n.b,a));}
    }
    if(n.t==='bin'&&n.o==='^'&&n.a.t==='var'&&n.a.n===variable&&isConst(n.b)){
      const p=evalAst(n.b); if(Math.abs(p+1)>EPS)return simplify(B('/',B('^',V(variable),N(p+1)),N(p+1)));return F('ln',F('abs',V(variable)));
    }
    if(n.t==='bin'&&n.o==='/'&&sameNum(n.a,1)&&n.b.t==='var'&&n.b.n===variable)return F('ln',F('abs',V(variable)));
    if(n.t==='fn'&&n.a.t==='var'&&n.a.n===variable){if(n.n==='sin')return U('-',F('cos',V(variable)));if(n.n==='cos')return F('sin',V(variable));if(n.n==='exp')return F('exp',V(variable));}
    if(n.t==='bin'&&n.o==='^'&&isConst(n.a)&&n.b.t==='var'&&n.b.n===variable){const base=evalAst(n.a);return B('/',n,F('ln',N(base)));}
    return null;
  }

  function extractMathSources(problem){
    const arr=[]; for(const s of problem?.mathSources||[]) if(s&&!arr.includes(s))arr.push(s);
    // If runtime extraction predates mathSources, pull common forms from text.
    const text=clean(problem?.text||'');
    return arr.length?arr:[text];
  }
  function findFunctionDefinition(problem){
    for(const src of extractMathSources(problem)){
      const m=clean(src).match(/(?:f\s*\(\s*x\s*\)|y)\s*=\s*(.+)$/i); if(m){try{return {src:clean(src),expr:m[1],ast:parseExpr(m[1])};}catch(_){}}
    }
    const t=clean(problem?.text||'');const m=t.match(/(?:f\s*\(\s*x\s*\)|y)\s*=\s*([^\n]+)/i);if(m){try{return {src:m[0],expr:m[1],ast:parseExpr(m[1])};}catch(_){}}
    return null;
  }

  // ---------- basic algebra / calculus solvers ----------
  function solveCalculusTrueFalse(problem){
    const choices=problem?.choices||[];if(choices.length!==2||!choices.every(c=>String(c.type).toLowerCase()==='radio'))return null;
    const labels=choices.map(c=>clean(c.context).toLowerCase());const trueIdx=labels.findIndex(x=>x==='true'),falseIdx=labels.findIndex(x=>x==='false');if(trueIdx<0||falseIdx<0)return null;
    const t=clean(problem?.text||'');
    // Nonzero numerator over a denominator tending to zero cannot have a finite
    // two-sided real limit.
    if(/polynomials?/i.test(t)&&/p\s*\([^)]*\)\s*=\s*[+-]?(?!0(?:\D|$))\d/i.test(t)&&/q\s*\([^)]*\)\s*=\s*0/i.test(t)&&/(?:p\s*\(x\)\s*\/\s*q\s*\(x\)|\(p\s*\(x\)\)\s*\/\s*\(q\s*\(x\)\))/i.test(t)&&/does\s+not\s+exist/i.test(t)){
      return {ok:true,engine:'calculus',confidence:'high',selections:[trueIdx],answer:'True',answerMath:'True',steps:['Polynomials are continuous, so the numerator approaches a nonzero number while the denominator approaches 0.','A finite quotient limit cannot result, so the statement is true.'],richSteps:[{label:'Result:',formulas:['True']}],debug:{type:'limit-theorem-truefalse'}};
    }
    // A common difference-quotient misconception: f(x+h) must replace every x
    // in the formula, not simply add h to f(x).
    if(/f\s*\(x\)\s*=\s*a\s*x\^?2\s*\+\s*b\s*x\s*\+\s*c/i.test(t)&&/f\s*\(x\s*\+\s*\d+/i.test(t)&&/a\s*x\^?2\s*\+\s*b\s*x\s*\+\s*c\s*\+\s*\d+/i.test(t)){
      const shift=Number(t.match(/f\s*\(x\s*\+\s*(\d+)/i)?.[1]);
      if(!Number.isFinite(shift)||shift<=0)return null;
      const square=shift*shift,twice=2*shift;
      const teaching=[
        {explanation:'Replace every x in the function with the new input.',math:[`f(x+${shift})=a*(x+${shift})^2+b*(x+${shift})+c`]},
        {explanation:'Expand the square and distribute the coefficients.',math:[`f(x+${shift})=a*x^2+${twice}*a*x+${square}*a+b*x+${shift}*b+c`]},
        {explanation:'Subtract the original function; matching terms cancel.',math:[`f(x+${shift})-f(x)=${twice}*a*x+${square}*a+${shift}*b`]},
        {explanation:`Divide by ${shift} and compare with the expression in the question.`,math:[`(f(x+${shift})-f(x))/${shift}=2*a*x+${shift}*a+b`]},
        {explanation:'Adding the input shift to the old output is not substitution, so the proposed equality is false.',math:[]}
      ];
      return {ok:true,engine:'calculus',confidence:'high',selections:[falseIdx],answer:'False',answerMath:'False',steps:teaching.map(s=>s.explanation),solution:{steps:teaching},debug:{type:'difference-quotient-truefalse'}};
    }
    return null;
  }
  function solveLogConversion(problem){
    const prompt=clean(problem?.text||'');
    if(!/logarithmic\s+form|exponential\s+form/i.test(prompt))return null;
    const sources=extractMathSources(problem);
    if(/logarithmic\s+form/i.test(prompt)){
      for(const s0 of sources){
        let s=compact(s0);
        const embedded=s.match(/((?:10|e|\d+(?:\.\d+)?|[A-Za-z]|\([^()]+\))\^\(?[A-Za-z0-9./+*-]+\)?=[A-Za-z0-9./+*-]+)/);
        if(embedded)s=embedded[1];
        const m=s.match(/^(.+?)\^\(?([^=]+?)\)?=(.+)$/);if(!m)continue;
        let [_,base,exponent,result]=m;base=base.replace(/^\((.*)\)$/,'$1');result=result.replace(/^\((.*)\)$/,'$1');
        let entry,display;
        if(base==='10'){entry=`log(${result})=${exponent}`;display=`log(${result}) = ${exponent}`;}
        else if(base==='e'){entry=`ln(${result})=${exponent}`;display=`ln(${result}) = ${exponent}`;}
        else {entry=`ln(${result})/ln(${base})=${exponent}`;display=`log base ${base} of ${result} = ${exponent}`;}
        return {ok:true,engine:'calculus',confidence:'high',entry,answer:entry,answerMath:entry,steps:[`Use a^b = c  ⇔  log base a of c = b.`,`Here the base is ${base}, the result is ${result}, and the exponent is ${exponent}.`,`So the logarithmic form is ${display}.`],richSteps:[{label:'Conversion rule:',formulas:['a^b=c','log_a(c)=b']},{label:'Apply it:',formulas:[entry]}],debug:{type:'log-conversion'}};
      }
    }
    if(/exponential\s+form/i.test(prompt)){
      for(const s0 of sources){
        const s=compact(s0);
        let m=s.match(/^log_?\(?([^,()]+)\)?\(([^)]+)\)=([^=]+)$/i); if(m){const entry=`${m[1]}^(${m[3]})=${m[2]}`;return {ok:true,engine:'calculus',confidence:'high',entry,answer:entry,answerMath:entry,steps:['Use log base a of c = b  ⇔  a^b = c.'],richSteps:[{label:'Convert to exponential form:',formulas:[entry]}]};}
        m=s.match(/^ln\(([^)]+)\)=([^=]+)$/i);if(m){const entry=`e^(${m[2]})=${m[1]}`;return {ok:true,engine:'calculus',confidence:'high',entry,answer:entry,answerMath:entry,steps:['ln uses base e.'],richSteps:[{label:'Convert to exponential form:',formulas:[entry]}]};}
        m=s.match(/^log\(([^)]+)\)=([^=]+)$/i);if(m){const entry=`10^(${m[2]})=${m[1]}`;return {ok:true,engine:'calculus',confidence:'high',entry,answer:entry,answerMath:entry,steps:['Common log uses base 10.'],richSteps:[{label:'Convert to exponential form:',formulas:[entry]}]};}
      }
    }
    return null;
  }

  function derivativePointTarget(problem){
    const text=clean(problem?.text||'');
    let m=text.match(/f\s*'\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*\)/i);
    if(m)return Number(m[1]);
    m=text.match(/(?:derivative|slope)[\s\S]{0,80}?(?:at|when)\s+x\s*=\s*([+-]?\d+(?:\.\d+)?)/i);
    return m?Number(m[1]):null;
  }
  function solveDerivative(problem){
    const prompt=clean(problem?.text||'');
    if(!/(find|compute|determine|evaluate).*?(derivative|f'\s*\(|dy\/dx|d\/dx)|differentiate/i.test(prompt))return null;
    const def=findFunctionDefinition(problem); if(!def)return null;
    const d=simplify(derivative(def.ast,'x')); const dtext=astText(d);
    if(!dtext||dtext.includes('NaN'))return null;
    const at=derivativePointTarget(problem);
    if(Number.isFinite(at)){
      const val=evalAst(d,{x:at}); if(!Number.isFinite(val))return null;
      const entry=answerNum(val);
      return {ok:true,engine:'calculus',confidence:'high',entry,answer:entry,answerMath:entry,
        steps:[`Differentiate ${def.expr}.`,`This gives f'(x) = ${dtext}.`,`Substitute x = ${fmt(at)} to get f'(${fmt(at)}) = ${entry}.`],
        richSteps:[{label:'Differentiate:',formulas:[`f'(x)=${dtext}`]},{label:'Evaluate:',formulas:[`f'(${fmt(at)})=${entry}`]}],debug:{type:'derivative-at-point',at}};
    }
    const entry=dtext;
    return {ok:true,engine:'calculus',confidence:'high',entry,answer:entry,answerMath:entry,steps:[`Differentiate ${def.expr} term by term and apply the product/quotient/chain rules as needed.`,`Simplify the derivative to ${entry}.`],richSteps:[{label:'Function:',formulas:[`f(x)=${def.expr}`]},{label:'Derivative:',formulas:[`f'(x)=${entry}`]}],debug:{type:'derivative'}};
  }

  function parsePointTarget(text){const m=clean(text).match(/(?:at|when)\s+x\s*=\s*([+-]?\d+(?:\.\d+)?)/i);return m?Number(m[1]):null;}
  function solveTangentLine(problem){
    const prompt=clean(problem?.text||''); if(!/tangent\s+line/i.test(prompt))return null;
    const def=findFunctionDefinition(problem);const x0=parsePointTarget(prompt);if(!def||!Number.isFinite(x0))return null;
    const d=simplify(derivative(def.ast,'x')),y0=evalAst(def.ast,{x:x0}),m=evalAst(d,{x:x0});if(!Number.isFinite(y0)||!Number.isFinite(m))return null;
    const b=y0-m*x0; const mtxt=answerNum(m),btxt=answerNum(b),entry=`y=${mtxt}*x${b>=0?'+':''}${btxt}`;
    return {ok:true,engine:'calculus',confidence:'high',entry,answer:entry,answerMath:entry,steps:[`Compute f(${fmt(x0)}) = ${answerNum(y0)}.`,`Differentiate to get f'(x) = ${astText(d)}.`,`The slope is f'(${fmt(x0)}) = ${mtxt}.`,`Use y-y0=m(x-x0) and simplify.`],richSteps:[{label:'Point:',formulas:[`(${fmt(x0)},${answerNum(y0)})`]},{label:'Slope:',formulas:[`m=${mtxt}`]},{label:'Tangent line:',formulas:[entry]}],debug:{type:'tangent-line'}};
  }

  function trendEstimate(vals){
    const good=vals.filter(Number.isFinite); if(good.length<4)return null;
    const tail=good.slice(-5); const last=tail.at(-1);
    const abs=tail.map(Math.abs);
    const signs=tail.map(Math.sign).filter(Boolean);
    const sameSign=signs.length>=3 && signs.every(s=>s===signs[0]);
    const growing=abs.length>=4 && abs.slice(1).every((v,i)=>v>=abs[i]*0.92) && abs.at(-1)>Math.max(100,abs[0]*2);
    if(sameSign && growing) return signs[0]>0?Infinity:-Infinity;
    const spread=Math.max(...tail)-Math.min(...tail); const center=tail.reduce((a,b)=>a+b,0)/tail.length;
    if(spread<2e-4*Math.max(1,Math.abs(center)))return center;
    // Richardson-like use of the last value is acceptable only if the recent
    // sequence is clearly stabilizing.
    const d=[];for(let i=1;i<tail.length;i++)d.push(Math.abs(tail[i]-tail[i-1]));
    if(d.length>=3 && d.at(-1)<d[0]*0.35)return last;
    return null;
  }
  function numericalLimit(ast,target,side='two',variable='x'){
    if(target===Infinity||target===-Infinity){
      const sign=target===Infinity?1:-1;
      const xs=[10,30,100,300,1000,3000,10000,100000,1000000,10000000].map(v=>v*sign);
      return trendEstimate(xs.map(v=>evalAst(ast,{[variable]:v})));
    }
    const hs=[1e-1,5e-2,2e-2,1e-2,5e-3,2e-3,1e-3,5e-4,2e-4,1e-4,5e-5,2e-5];
    const seq = sign => hs.map(h=>evalAst(ast,{[variable]:target+sign*h}));
    const left=trendEstimate(seq(-1)),right=trendEstimate(seq(1));
    if(side==='left')return left;if(side==='right')return right;
    if(left==null||right==null)return null;
    if(left===Infinity&&right===Infinity)return Infinity;
    if(left===-Infinity&&right===-Infinity)return -Infinity;
    if(!Number.isFinite(left)||!Number.isFinite(right))return 'DNE';
    if(Math.abs(left-right)<2e-3*Math.max(1,Math.abs(left),Math.abs(right)))return (left+right)/2;
    return 'DNE';
  }
  function parseLimitTarget(raw){
    const t=String(raw).toLowerCase().replace(/\s+/g,'');
    if(['oo','+oo','infinity','+infinity'].includes(t))return Infinity;
    if(['-oo','-infinity'].includes(t))return -Infinity;
    try{const v=evalAst(parseExpr(raw),{});if(Number.isFinite(v))return v;}catch(_){}
    return Number(t);
  }
  function normalizeLimitSource(src){
    return clean(rewriteTexFractions(src))
      .replace(/\\rightarrow|\\to/g,'->')
      .replace(/\\left|\\right/g,'')
      .replace(/\b(?:rarr|arrow|to)\b/gi,'->')
      .replace(/∞/g,'oo').replace(/infty/gi,'oo')
      .replace(/\\(?:,|;|!| )/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }
  function takeBalanced(s,pos){
    while(pos<s.length&&/\s/.test(s[pos]))pos++;
    const open=s[pos], close=open==='('?')':open==='{'?'}':null;if(!close)return null;let d=0;
    for(let i=pos;i<s.length;i++){if(s[i]===open)d++;else if(s[i]===close){d--;if(d===0)return{body:s.slice(pos+1,i),end:i+1};}}
    return null;
  }
  function parseLimitSpec(src0){
    let src=normalizeLimitSource(src0)
      .replace(/\\lim\s*[_]?\s*\{([^{}]+)\}/g,'lim_($1)')
      .replace(/\\lim/g,'lim');
    const lm=/lim/i.exec(src);if(!lm)return null;let pos=lm.index+lm[0].length;
    while(pos<src.length&&/\s/.test(src[pos]))pos++;if(src[pos]==='_')pos++;
    const g=takeBalanced(src,pos);if(!g)return null;
    const rel=g.body.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*->\s*(.+?)\s*$/);if(!rel)return null;
    const variable=rel[1];let targetRaw=rel[2].trim(),sideMark='';
    const sm=targetRaw.match(/\^\s*\(?\s*([+-])\s*\)?\s*$/);if(sm){sideMark=sm[1];targetRaw=targetRaw.slice(0,sm.index).trim();}
    let expr=src.slice(g.end).trim().replace(/^\\+/,'').replace(/=\s*$/,'').trim();
    return {src,variable,targetRaw,sideMark,expr};
  }

  function evaluateLimitSpec(problem,spec){
    if(!spec||!spec.expr)return null;
    const target=parseLimitTarget(spec.targetRaw);if(Number.isNaN(target))return null;
    try{
      let ast; const fref=new RegExp(`^f\\s*\\(\\s*${spec.variable}\\s*\\)$`,'i');
      if(fref.test(spec.expr)){const def=findFunctionDefinition(problem);if(!def)return null;ast=def.ast;}else ast=parseExpr(spec.expr);
      let direct=NaN,val;
      if(Number.isFinite(target))direct=evalAst(ast,{[spec.variable]:target});
      // Very large direct values near known singularities are floating-point
      // artifacts (for example sec(pi/2)); use the one-sided numerical trend.
      if(Number.isFinite(direct)&&Math.abs(direct)<1e10)val=direct;
      else val=numericalLimit(ast,target,spec.sideMark==='+'?'right':spec.sideMark==='-'?'left':'two',spec.variable);
      if(val==null)return null;
      return {val,entry:val==='DNE'?'DNE':limitAnswerNum(val),target,variable:spec.variable,expr:spec.expr,sideMark:spec.sideMark};
    }catch(_){return null;}
  }
  function solveLimitBundle(problem){
    const answers=(problem.answers||[]).filter(a=>!['radio','checkbox'].includes(String(a.type).toLowerCase()));if(answers.length<2)return null;
    const specs=extractMathSources(problem).map(parseLimitSpec).filter(Boolean);if(specs.length<2||specs.length!==answers.length)return null;
    const out=specs.map(s=>evaluateLimitSpec(problem,s));if(out.some(x=>!x))return null;const entries=out.map(x=>x.entry);
    return {ok:true,engine:'calculus',confidence:'high',entries,answer:entries.join(', '),answerMath:entries.join(','),steps:out.map(x=>`As ${x.variable} approaches ${x.target===Infinity?'oo':x.target===-Infinity?'-oo':limitAnswerNum(x.target)}${x.sideMark==='+'?' from the right':x.sideMark==='-'?' from the left':''}, the expression approaches ${x.entry}.`),richSteps:[{label:'Limits:',formulas:entries}],debug:{type:'limit-bundle'}};
  }
  function solveTrigVerticalAsymptoteBundle(problem){
    const answers=(problem.answers||[]).filter(a=>!['radio','checkbox'].includes(String(a.type).toLowerCase()));if(answers.length<4||!/vertical\s+asymptote/i.test(problem.text||''))return null;
    const specs=extractMathSources(problem).map(parseLimitSpec).filter(Boolean);if(specs.length<2)return null;const outs=specs.map(s=>evaluateLimitSpec(problem,s));if(outs.some(x=>!x))return null;
    const entries=[];for(let i=0;i<Math.min(2,outs.length);i++){entries.push(outs[i].entry);let t;try{t=astText(parseExpr(specs[i].targetRaw));}catch(_){t=specs[i].targetRaw;}entries.push(t);}
    if(entries.length!==4)return null;return {ok:true,engine:'calculus',confidence:'high',entries,answer:entries.join(', '),answerMath:entries.join(','),steps:[`A vertical asymptote occurs where the trig function is undefined.`,`Check the requested side of each asymptote to determine the sign of infinity.`],richSteps:[{label:'Enter in order:',formulas:entries}],debug:{type:'trig-asymptote-bundle'}};
  }
  function solveSqueezeTheorem(problem){
    if(!/squeeze\s+theorem/i.test(problem.text||''))return null;const answers=(problem.answers||[]).filter(a=>!['radio','checkbox'].includes(String(a.type).toLowerCase()));if(answers.length<3)return null;
    const specs=extractMathSources(problem).map(parseLimitSpec).filter(s=>s&&!/^g\s*\(/i.test(s.expr));if(specs.length<2)return null;const a=evaluateLimitSpec(problem,specs[0]),b=evaluateLimitSpec(problem,specs[1]);if(!a||!b)return null;const same=a.entry===b.entry;const entries=[a.entry,b.entry,same?a.entry:'DNE'];
    return {ok:true,engine:'calculus',confidence:'high',entries,answer:entries.join(', '),answerMath:entries.join(','),steps:[`The lower bound approaches ${a.entry}.`,`The upper bound approaches ${b.entry}.`,same?`Because both bounds approach ${a.entry}, the Squeeze Theorem gives the same limit for g(x).`:'The bounds do not approach the same value, so this data does not determine one squeezed limit.'],richSteps:[{label:'Squeeze theorem:',formulas:entries}],debug:{type:'squeeze-theorem'}};
  }
  function solveGeneralLimit(problem){
    const prompt=clean(problem?.text||''); if(!/lim|limit/i.test(prompt))return null;
    const sources=extractMathSources(problem);
    for(const src0 of sources){
      const spec=parseLimitSpec(src0); if(!spec||!spec.expr)continue;
      const r=evaluateLimitSpec(problem,spec);if(!r)continue;
      const targetText=r.target===Infinity?'oo':r.target===-Infinity?'-oo':limitAnswerNum(r.target);
      const sideText=r.sideMark==='+'?' from the right':r.sideMark==='-'?' from the left':'';
      const direct=Number.isFinite(r.target)?(()=>{try{let ast;if(/^f\s*\(/i.test(spec.expr)){const d=findFunctionDefinition(problem);ast=d?.ast;}else ast=parseExpr(spec.expr);return ast?evalAst(ast,{[r.variable]:r.target}):NaN;}catch(_){return NaN;}})():NaN;
      return {ok:true,engine:'calculus',confidence:r.val==='DNE'?'medium':'high',entry:r.entry,answer:r.entry,answerMath:r.entry,
        steps:[Number.isFinite(direct)&&Math.abs(direct)<1e10?`Direct substitution gives ${r.entry}.`:`Evaluate the expression progressively closer to ${targetText}${sideText}.`,`The values ${r.val===Infinity?'increase without bound':r.val===-Infinity?'decrease without bound':r.val==='DNE'?'do not approach one common value':`approach ${r.entry}`}.`],
        richSteps:[{label:'Limit:',formulas:[`lim_(${r.variable}->${targetText}${r.sideMark}) ${r.expr} = ${r.entry}`]}],debug:{type:'general-limit',variable:r.variable,target:r.target,expr:r.expr}};
    }
    return null;
  }

  function solveIntegral(problem){
    const prompt=clean(problem?.text||''); if(!/(integral|antiderivative|∫)/i.test(prompt))return null;
    const sources=extractMathSources(problem); let expr=null,a=null,b=null;
    for(const s0 of sources){const s=compact(s0);let m=s.match(/int_?\(?([+-]?\d+(?:\.\d+)?)\)?\^\(?([+-]?\d+(?:\.\d+)?)\)?(.+?)(?:dx|d x)$/i);if(m){a=Number(m[1]);b=Number(m[2]);expr=m[3];break;}m=s.match(/int(.+?)(?:dx|d x)$/i);if(m){expr=m[1];break;}}
    if(!expr){const m=prompt.match(/integral\s+of\s+(.+?)(?:\s+with|$)/i);if(m)expr=m[1];}
    if(!expr)return null;let ast;try{ast=parseExpr(expr);}catch(_){return null;}
    const Fint=integrateSimple(ast,'x');
    if(a!=null&&b!=null){let val;if(Fint){val=evalAst(Fint,{x:b})-evalAst(Fint,{x:a});}else{const Nn=1000,h=(b-a)/Nn;let sum=0;for(let i=0;i<=Nn;i++){const x=a+i*h,y=evalAst(ast,{x});if(!Number.isFinite(y))return null;sum+=(i===0||i===Nn?1:i%2?4:2)*y;}val=sum*h/3;}const entry=answerNum(val);return {ok:true,engine:'calculus',confidence:Fint?'high':'medium',entry,answer:entry,answerMath:entry,steps:[Fint?`An antiderivative is ${astText(Fint)}.`:'Use Simpson’s rule for a high-accuracy numerical integral.',`Evaluate from ${fmt(a)} to ${fmt(b)} to get ${entry}.`],richSteps:[{label:'Definite integral:',formulas:[entry]}]};}
    if(!Fint)return null;const entry=`${astText(Fint)}+C`;return {ok:true,engine:'calculus',confidence:'high',entry,answer:entry,answerMath:entry,steps:[`Apply the basic antiderivative rules term by term.`,`Include the constant of integration.`],richSteps:[{label:'Antiderivative:',formulas:[entry]}]};
  }


  // ---------- broader calculus / precalculus patterns ----------
  function parsePiecewise(problem){
    const src=extractMathSources(problem).find(x=>/f\s*\(\s*x\s*\)/i.test(x)&&(/"if"/i.test(x)||/\{\s*\(/.test(x)));
    if(!src)return null;
    const pieces=[]; const body=src.slice(src.indexOf('=')+1); const re=/\(([^,]+),\s*(?:"if",\s*)?([^\)]+)\)/gi; let m;
    while((m=re.exec(body))){
      let expr=clean(m[1]).replace(/^\s*\(/,'').trim();
      let cond=clean(m[2]).replace(/\\?leq|≤/g,'<=').replace(/\\?geq|≥/g,'>=').trim();
      try{pieces.push({expr,ast:parseExpr(expr),cond});}catch(_){}
    }
    return pieces.length?{src,pieces}:null;
  }
  function condParts(cond){
    const m=String(cond).match(/([A-Za-z][A-Za-z0-9_]*)\s*(<=|>=|<|>|=)\s*([+-]?\d+(?:\.\d+)?)/);return m?{v:m[1],op:m[2],a:Number(m[3])}:null;
  }
  function condTrue(cond,x){const c=condParts(cond);if(!c)return false; if(c.op==='<')return x<c.a;if(c.op==='<=')return x<=c.a;if(c.op==='>')return x>c.a;if(c.op==='>=')return x>=c.a;return Math.abs(x-c.a)<1e-9;}
  function pieceAt(pw,x){return pw?.pieces?.find(p=>condTrue(p.cond,x))||null;}
  function pieceLimit(pw,a,side='two',extra={}){
    const eps=1e-6;
    const one=s=>{const p=pieceAt(pw,a+s*eps);if(!p)return null;const v=evalAst(p.ast,{x:a,...extra});return Number.isFinite(v)?v:null;};
    const l=one(-1),r=one(1);if(side==='left')return l;if(side==='right')return r;if(l==null||r==null)return null;return Math.abs(l-r)<1e-8?(l+r)/2:'DNE';
  }
  function pieceValue(pw,a,extra={}){const p=pieceAt(pw,a);if(!p)return null;const v=evalAst(p.ast,{x:a,...extra});return Number.isFinite(v)?v:null;}
  function pieceBoundary(pw){for(const p of pw?.pieces||[]){const c=condParts(p.cond);if(c)return c.a;}return null;}
  function pieceFacts(pw,a){const left=pieceLimit(pw,a,'left'),right=pieceLimit(pw,a,'right'),value=pieceValue(pw,a);const limitExists=Number.isFinite(left)&&Number.isFinite(right)&&Math.abs(left-right)<1e-8;const defined=Number.isFinite(value);const equals=defined&&limitExists&&Math.abs(value-left)<1e-8;return{left,right,value,defined,limitExists,limit:limitExists?(left+right)/2:null,equals,continuous:equals};}
  function solvePiecewiseValues(problem){
    const pw=parsePiecewise(problem);if(!pw||!/(calculate|evaluate|find).*(?:values?|f\s*\()/i.test(problem?.text||''))return null;
    const targets=extractMathSources(problem).map(s=>String(s).match(/^\s*f\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*\)\s*=/i)).filter(Boolean).map(m=>Number(m[1]));
    const fields=(problem.answers||[]).filter(a=>!['radio','checkbox','hidden'].includes(String(a.type).toLowerCase())||!!a.dataMq);
    if(!targets.length||targets.length!==fields.length)return null;
    const entries=[],steps=[];
    for(const x of targets){
      const piece=pieceAt(pw,x);if(!piece)return null;
      const value=evalAst(piece.ast,{x});if(!Number.isFinite(value))return null;
      const entry=answerNum(value);entries.push(entry);
      steps.push({explanation:`At x=${fmt(x)}, use the piece whose condition is ${piece.cond}. Substitute into that formula and simplify.`,math:[`f(${fmt(x)})=${piece.expr.replace(/\s+/g,'').replace(/(?<![A-Za-z])x(?![A-Za-z])/g,`(${fmt(x)})`)}=${entry}`]});
    }
    return {ok:true,engine:'calculus',confidence:'high',entries,answer:entries.join(', '),answerMath:entries.join(','),steps:steps.map(s=>s.explanation),solution:{steps},verification:{ok:true,method:'piecewise-condition-evaluation',detail:'Each input satisfies its selected piece condition and its formula evaluates to the returned value.'},debug:{type:'piecewise-values'}};
  }
  function choiceMeaningLocal(t){t=clean(t).toLowerCase();if(/not\s+continuous/.test(t))return'notContinuous';if(/continuous/.test(t))return'continuous';if(/=\s*f\s*\(/.test(t))return'limitEqualsValue';if(/lim|limit/.test(t)&&/exists/.test(t))return'limitExists';if(/defined/.test(t))return'defined';return null;}
  function denominatorLinearRoots(ast){
    const roots=[];
    function walk(n){if(!n)return;if(n.t==='bin'&&n.o==='/'){const d=n.b;const y0=evalAst(d,{x:0}),y1=evalAst(d,{x:1});if(Number.isFinite(y0)&&Number.isFinite(y1)&&Math.abs(y1-y0)>1e-12){const r=-y0/(y1-y0);if(Number.isFinite(r)&&Math.abs(evalAst(d,{x:r}))<1e-7)roots.push(r);}walk(n.a);walk(n.b);return;}if(n.t==='bin'){walk(n.a);walk(n.b);}else if(n.t==='un'||n.t==='fn')walk(n.a);}
    walk(ast);return roots;
  }
  function pickSelectValue(answer,matcher){const opts=(answer?.options||[]).filter(o=>o.value!==''&&!/^select/i.test(o.text||''));const o=opts.find(x=>matcher(clean(x.text||'').toLowerCase()));return o?.value??null;}
  function solvePiecewiseLimitBundle(problem){
    const pw=parsePiecewise(problem);
    if(!pw)return null;
    const prompt=clean(problem?.text||'');
    if(!/(calculate|compute|lim_|limit)/i.test(prompt))return null;
    const a=pieceBoundary(pw);
    if(!Number.isFinite(a))return null;
    const answers=problem.answers||[];

    // Parameter-at-the-boundary problems: choose the parameter so the
    // left/right limits agree.
    if(/if\s+lim[\s\S]*exists|this\s+means\s+[a-z]\s*=/i.test(prompt)){
      const all=pw.pieces.map(p=>p.expr).join(' ');
      const param=(all.match(/\b([a-zA-Z])\s*x\b/g)||[])
        .map(z=>z.match(/([a-zA-Z])/)[1]).find(v=>v!=='x');
      if(param){
        const Lp=pieceAt(pw,a-1e-6), Rp=pieceAt(pw,a+1e-6);
        if(Lp&&Rp){
          const side=Rp.expr.includes(param)?Rp:Lp;
          const fixed=Rp.expr.includes(param)?Lp:Rp;
          const target=evalAst(fixed.ast,{x:a,[param]:0});
          const v0=evalAst(side.ast,{x:a,[param]:0});
          const v1=evalAst(side.ast,{x:a,[param]:1});
          const slope=v1-v0;
          if([target,v0,v1].every(Number.isFinite)&&Math.abs(slope)>1e-12&&answers.length>=4){
            const pv=(target-v0)/slope;
            const coeff=answerNum(slope),constant=answerNum(v0);
            const symbolic = Math.abs(v0)<1e-12
              ? (Math.abs(slope-1)<1e-12?param:Math.abs(slope+1)<1e-12?`-${param}`:`${coeff}*${param}`)
              : `${constant}${slope>=0?'+':''}${coeff}*${param}`;
            const leftEntry=side===Lp?symbolic:answerNum(target);
            const rightEntry=side===Rp?symbolic:answerNum(target);
            const entries=[leftEntry,rightEntry,answerNum(target),answerNum(pv)];
            return {ok:true,engine:'calculus',confidence:'high',entries,answer:entries.join(', '),answerMath:entries.join(','),steps:[`The left-hand formula approaches ${leftEntry} at x=${fmt(a)}.`,`The right-hand formula approaches ${rightEntry} at x=${fmt(a)}.`,`For the two-sided limit to exist, set ${symbolic}=${answerNum(target)} and solve: ${param}=${answerNum(pv)}.`],richSteps:[{label:'One-sided limits:',formulas:[`left=${leftEntry}`,`right=${rightEntry}`]},{label:'Continuity condition:',formulas:[`${symbolic}=${answerNum(target)}`,`${param}=${answerNum(pv)}`]}],debug:{type:'piecewise-limit-parameter'}};
          }
        }
      }
    }

    const f=pieceFacts(pw,a);
    // Plain left/right/two-sided limit bundles.
    if(answers.length===3 && answers.every(x=>String(x.tag).toUpperCase()!=='SELECT')){
      const entries=[f.left==null?'DNE':answerNum(f.left),f.right==null?'DNE':answerNum(f.right),f.limitExists?answerNum(f.limit):'DNE'];
      return {ok:true,engine:'calculus',confidence:'high',entries,answer:entries.join(', '),answerMath:entries.join(','),steps:[`Evaluate the left formula at x=${fmt(a)}: ${entries[0]}.`,`Evaluate the right formula at x=${fmt(a)}: ${entries[1]}.`,f.limitExists?`The one-sided limits agree, so the limit is ${entries[2]}.`:'The one-sided limits disagree, so the two-sided limit is DNE.'],richSteps:[{label:'Limits:',formulas:entries}],debug:{type:'piecewise-limit-bundle',facts:f}};
    }

    // Full continuity/discontinuity bundle with selects and a list of all
    // discontinuities caused by denominators or a boundary mismatch.
    if(answers.length>=5 && answers.some(x=>String(x.tag).toUpperCase()==='SELECT')){
      const entryMap={};
      const calc=answers.filter(x=>String(x.tag).toUpperCase()!=='SELECT');
      if(calc[0])entryMap[calc[0].id]=f.left==null?'DNE':answerNum(f.left);
      if(calc[1])entryMap[calc[1].id]=f.right==null?'DNE':answerNum(f.right);
      if(calc[2])entryMap[calc[2].id]=f.defined?answerNum(f.value):'DNE';
      const sels=answers.filter(x=>String(x.tag).toUpperCase()==='SELECT');
      if(sels[0]){
        const status=!f.defined||f.left==null||f.right==null?'not all defined':f.continuous?'all defined and equal':'defined but not all equal';
        const v=pickSelectValue(sels[0],t=>t.includes(status));if(v!=null)entryMap[sels[0].id]=v;
      }
      if(sels[1]){
        const v=pickSelectValue(sels[1],t=>f.continuous?(/^continuous$/.test(t)):t.includes('discontinuous'));
        if(v!=null)entryMap[sels[1].id]=v;
      }
      const dis=[];
      for(const p of pw.pieces){for(const r of denominatorLinearRoots(p.ast)){if(condTrue(p.cond,r))dis.push(r);}}
      if(!f.continuous)dis.push(a);
      const uniq=[...new Set(dis.map(x=>Number(x.toFixed(9))))].sort((x,y)=>x-y);
      if(calc.length>3)entryMap[calc.at(-1).id]=uniq.map(answerNum).join(',');
      return {ok:true,engine:'calculus',confidence:'high',entryMap,answer:Object.values(entryMap).join(', '),answerMath:Object.values(entryMap).join(','),steps:[`At x=${fmt(a)}, left limit = ${f.left==null?'DNE':answerNum(f.left)}, right limit = ${f.right==null?'DNE':answerNum(f.right)}, and f(${fmt(a)}) = ${f.defined?answerNum(f.value):'DNE'}.`,f.continuous?'The function is continuous at the boundary.':'The function is discontinuous at the boundary.',`Discontinuities: ${uniq.length?uniq.map(answerNum).join(', '):'none'}.`],richSteps:[{label:'Boundary check:',formulas:[`left=${f.left==null?'DNE':answerNum(f.left)}`,`right=${f.right==null?'DNE':answerNum(f.right)}`,`f(${fmt(a)})=${f.defined?answerNum(f.value):'DNE'}`]}],debug:{type:'piecewise-full-bundle',facts:f,discontinuities:uniq}};
    }
    return null;
  }

  function solvePiecewiseContinuityChoices(problem){
    const pw=parsePiecewise(problem);const choices=problem?.choices||[];if(!pw||choices.length<3||!choices.every(c=>['checkbox','radio'].includes(String(c.type).toLowerCase())))return null;
    if(!/continuous|continuity/i.test(problem.text||''))return null;const a=pieceBoundary(pw);if(!Number.isFinite(a))return null;const f=pieceFacts(pw,a);
    if(choices.every(c=>String(c.type).toLowerCase()==='checkbox')){
      const truth={defined:f.defined,limitExists:f.limitExists,limitEqualsValue:f.equals,continuous:f.continuous,notContinuous:!f.continuous};const selections=[];
      choices.forEach((c,i)=>{const k=choiceMeaningLocal(c.context);if(k&&truth[k])selections.push(i);});if(!selections.length)return null;
      return {ok:true,engine:'calculus',confidence:'high',selections,answer:selections.map(i=>i+1).join(', '),answerMath:selections.map(i=>i+1).join(','),steps:[`At x=${fmt(a)}, the left-hand limit is ${f.left==null?'DNE':answerNum(f.left)} and the right-hand limit is ${f.right==null?'DNE':answerNum(f.right)}.`,`f(${fmt(a)}) is ${f.defined?answerNum(f.value):'undefined'}.`,f.continuous?'All continuity conditions hold.':'The continuity conditions are not all satisfied.'],richSteps:[{label:'At the boundary:',formulas:[`left=${f.left==null?'DNE':answerNum(f.left)}`,`right=${f.right==null?'DNE':answerNum(f.right)}`,`f(${fmt(a)})=${f.defined?answerNum(f.value):'undefined'}`]}],debug:{type:'piecewise-continuity',facts:f}};
    }
    return null;
  }
  function solveContinuityParameter(problem){
    const pw=parsePiecewise(problem);if(!pw||!/(continuous\s+everywhere|must\s+have)/i.test(problem.text||''))return null;
    const a=pieceBoundary(pw);if(!Number.isFinite(a))return null;const src=pw.src;const pm=(src.match(/\b([a-zA-Z])\s*x\b/g)||[]).map(z=>z.match(/([a-zA-Z])/)[1]).find(v=>v!=='x');if(!pm)return null;
    const leftP=pieceAt(pw,a-1e-6),rightP=pieceAt(pw,a+1e-6);if(!leftP||!rightP)return null;
    const sideWithParam=[leftP,rightP].find(p=>p.expr.includes(pm));const fixed=[leftP,rightP].find(p=>!p.expr.includes(pm));if(!sideWithParam||!fixed)return null;
    const target=evalAst(fixed.ast,{x:a});const v0=evalAst(sideWithParam.ast,{x:a,[pm]:0}),v1=evalAst(sideWithParam.ast,{x:a,[pm]:1});const slope=v1-v0;if(![target,v0,v1].every(Number.isFinite)||Math.abs(slope)<1e-12)return null;const val=(target-v0)/slope,entry=answerNum(val);
    return {ok:true,engine:'calculus',confidence:'high',entry,answer:entry,answerMath:entry,steps:[`Continuity at x=${fmt(a)} requires the left and right formulas to have the same value.`,`Set ${sideWithParam.expr} equal to ${fixed.expr} at x=${fmt(a)} and solve for ${pm}.`,`This gives ${pm}=${entry}.`],richSteps:[{label:'Continuity equation:',formulas:[`${pm}=${entry}`]}],debug:{type:'continuity-parameter',parameter:pm}};
  }
  function solveRemovableDiscontinuity(problem){
    const prompt=clean(problem?.text||'');if(!/removable\s+discontinuity/i.test(prompt)||!/define\s*f\s*\(/i.test(prompt))return null;const def=findFunctionDefinition(problem);if(!def)return null;
    const m=prompt.match(/(?:at\s+x\s*=|define\s+f\s*\()\s*([+-]?\d+(?:\.\d+)?)/i);if(!m)return null;const a=Number(m[1]);const v=numericalLimit(def.ast,a,'two','x');if(!Number.isFinite(v))return null;const entry=limitAnswerNum(v);
    return {ok:true,engine:'calculus',confidence:'high',entry,answer:entry,answerMath:entry,steps:[`A removable discontinuity is repaired by defining f(${fmt(a)}) equal to the limit.`,`Evaluate lim_(x->${fmt(a)}) f(x) = ${entry}.`,`Define f(${fmt(a)})=${entry}.`],richSteps:[{label:'Fill the hole:',formulas:[`f(${fmt(a)})=${entry}`]}],debug:{type:'removable-discontinuity'}};
  }
  function solveIVTMinimumRoots(problem){
    if(!/continuous\s+function/i.test(problem?.text||'')||!/minimum\s+number\s+of\s+solutions|at\s+least/i.test(problem?.text||''))return null;const table=(problem.tables||[])[0];if(!table?.rows?.length)return null;
    const vals=table.rows.flat().filter(c=>c?.value!==null&&c?.value!==undefined&&c?.value!=='').map(c=>Number(c.value)).filter(Number.isFinite);if(vals.length<2)return null;let n=0;for(let i=1;i<vals.length;i++){if(vals[i]*vals[i-1]<0)n++;}const entry=String(n);
    return {ok:true,engine:'calculus',confidence:'high',entry,answer:entry,answerMath:entry,steps:['Because f is continuous, each sign change forces at least one zero by the Intermediate Value Theorem.',`There are ${n} forced sign-change interval(s).`],richSteps:[{label:'Minimum zeros:',formulas:[entry]}],debug:{type:'ivt-roots'}};
  }
  function candidateSegments(problem){
    const g=(problem.graphs||[])[0];
    const scripted=coloredPaths(g?.dataScript).map(p=>({points:p.points,stroke:p.color}));
    const raw=scripted.length?scripted:(g?.segments||[]);
    const segs=raw.filter(s=>Array.isArray(s.points)&&s.points.length>=8&&!['#757575','gray','grey'].includes(String(s.stroke||'').toLowerCase()));
    return segs.filter(s=>{const xs=s.points.map(p=>p[0]),ys=s.points.map(p=>p[1]);return Math.max(...xs)-Math.min(...xs)>.4&&Math.max(...ys)-Math.min(...ys)>.4;});
  }
  function solveGraphFunctionChoice(problem){
    const choices=(problem.choices||[]).filter(c=>String(c.type).toLowerCase()==='radio');if(choices.length<2||!/(which.*function|shown\s+on\s+the\s+graph)/i.test(problem.text||''))return null;const segs=candidateSegments(problem);if(!segs.length)return null;
    let best=null;choices.forEach((c,i)=>{const m=clean(c.context).match(/(?:f\s*\(x\)|y)\s*=\s*(.+)$/i);if(!m)return;let ast;try{ast=parseExpr(m[1]);}catch(_){return;}let err=Infinity;for(const seg of segs)err=Math.min(err,curveError(ast,seg.points));if(!best||err<best.err)best={i,err,expr:m[1]};});
    if(!best||!Number.isFinite(best.err)||best.err>0.3)return null;return {ok:true,engine:'calculus',confidence:'high',selections:[best.i],answer:choices[best.i].context,answerMath:choices[best.i].context,steps:['Compare the candidates against the plotted curve using its asymptote, direction, intercepts, and sampled points.',`The matching equation is ${choices[best.i].context}.`],richSteps:[{label:'Matching function:',formulas:[choices[best.i].context]}],debug:{type:'graph-function-choice',error:best.err}};
  }
  function solveLogExpansionCoefficients(problem){
    const prompt=clean(problem?.text||'');if(!/ln\s*\(|log\s*\(/i.test(prompt)||!/[ABC]\s*=/.test(prompt)||!(problem.answers||[]).length)return null;const src=extractMathSources(problem).find(s=>/ln|log/i.test(s)&&/A\s*\\?(?:ln|log)/i.test(s));if(!src)return null;
    const lhs=src.split('=')[0].trim();const m=lhs.match(/(?:ln|log)\s*\((.*)\)\s*$/i);if(!m)return null;let ast;try{ast=parseExpr(m[1]);}catch(_){return null;}const terms={};
    function addFactor(n,c){n=simplify(n);if(n.t==='bin'&&n.o==='*'){addFactor(n.a,c);addFactor(n.b,c);return;}if(n.t==='bin'&&n.o==='/'){addFactor(n.a,c);addFactor(n.b,-c);return;}if(n.t==='bin'&&n.o==='^'&&isConst(n.b)){addFactor(n.a,c*evalAst(n.b));return;}if(n.t==='fn'&&n.n==='sqrt'){addFactor(n.a,c/2);return;}const k=astText(n).replace(/\*/g,'');terms[k]=(terms[k]||0)+c;}
    addFactor(ast,1);
    const rhs=src.split('=').slice(1).join('=');const wanted=[...rhs.matchAll(/\b[ABC]\s*(?:\\?ln|\\?log)\s*(?:\(\s*([^)]*?)\s*\)|([A-Za-z]))/gi)].map(m=>(m[1]||m[2]).trim());
    if(wanted.length!==3)return null;
    const entries=wanted.map(k=>answerNum(terms[k]??terms[k.replace(/\*/g,'')]??0));if(entries.every(v=>v==='0'))return null;
    const logName=/^\\?ln/i.test(lhs)?'ln':'log';
    const expansion=wanted.map((factor,i)=>`${entries[i]}*${logName}(${factor})`).join('+').replace(/\+-(?=\d)/g,'-');
    return {ok:true,engine:'calculus',confidence:'high',entries,answer:entries.join(', '),answerMath:entries.join(','),steps:['Split the logarithm of a quotient into a difference of logarithms.','Split products into sums, and use the power rule to move exponents in front.','Compare the coefficients of the three requested logarithms.'],solution:{steps:[{explanation:'Use the quotient rule: the denominator contributes a negative term.',math:[`${logName}(${astText(ast)})`]},{explanation:'Use the product and power rules to expand each factor.',math:[expansion]},{explanation:'Match the coefficients in the requested order.',math:[`A=${entries[0]}`,`B=${entries[1]}`,`C=${entries[2]}`]}]},debug:{type:'log-expansion'}};
  }
  function solveSimpleExpLogEquation(problem){
    const prompt=clean(problem?.text||'');if(!/solve.*\bx\b/i.test(prompt))return null;const src=extractMathSources(problem).find(s=>/=/.test(s)&&!/f\s*\(x\)/i.test(s));if(!src)return null;const s=compact(src);
    let m=s.match(/^([0-9.]+)\^\(?x\/([0-9.]+)\)?=([0-9.]+)$/);if(m){const A=Number(m[1]),B=Number(m[2]),C=Number(m[3]);const entry=`${fmt(B)}*ln(${fmt(C)})/ln(${fmt(A)})`;return {ok:true,engine:'calculus',confidence:'high',entry,answer:entry,answerMath:entry,steps:[`Take ln of both sides.`,`(x/${fmt(B)})ln(${fmt(A)})=ln(${fmt(C)}).`,`Solve for x.`],richSteps:[{label:'Answer:',formulas:[`x=${entry}`]}],debug:{type:'exp-equation'}};}
    m=s.match(/^ln\(([-+0-9.]*x(?:[-+][0-9.]+)?)\)([-+]\d+(?:\.\d+)?)=([-+]?\d+(?:\.\d+)?)$/i);if(m){let inner=m[1],c=Number(m[2]),rhs=Number(m[3]);let ast;try{ast=parseExpr(inner);}catch(_){return null;}const target=Math.exp(rhs-c);const v0=evalAst(ast,{x:0}),v1=evalAst(ast,{x:1}),a=v1-v0;if(!Number.isFinite(a)||Math.abs(a)<1e-12)return null;const x=(target-v0)/a;let decimals=(prompt.match(/(\d+)\s+decimal/i)||[])[1];if(!decimals){const words={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};const wm=prompt.toLowerCase().match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+decimal/);if(wm)decimals=words[wm[1]];}const entry=decimals?x.toFixed(Number(decimals)):answerNum(x);return {ok:true,engine:'calculus',confidence:'high',entry,answer:entry,answerMath:entry,steps:[`Isolate the logarithm: ln(${inner})=${fmt(rhs-c)}.`,`Exponentiate: ${inner}=e^${fmt(rhs-c)}.`,`Solve for x to get ${entry}.`],richSteps:[{label:'Answer:',formulas:[`x=${entry}`]}],debug:{type:'log-equation'}};}
    return null;
  }
  function solveNumericalLimitTable(problem){
    if(!/(evaluating\s+the\s+function|inputs\s+listed\s+in\s+this\s+table|guess\s+the\s+value\s+of\s+the\s+limit)/i.test(problem?.text||''))return null;const def=findFunctionDefinition(problem),table=(problem.tables||[])[0];if(!def||!table?.rows?.length)return null;const xs=[];for(const row of table.rows){const c=row.find(x=>Number.isFinite(Number(x?.value))&&!x.answerId);if(c)xs.push(Number(c.value));}if(!xs.length)return null;const vals=xs.map(x=>evalAst(def.ast,{x}));if(vals.some(v=>!Number.isFinite(v)))return null;
    const targetSpec=extractMathSources(problem).map(parseLimitSpec).find(Boolean);const target=targetSpec?parseLimitTarget(targetSpec.targetRaw):0;const lim=numericalLimit(def.ast,target,'two','x');if(!Number.isFinite(lim))return null;const entries=[...vals.map(v=>v.toFixed(8)),limitAnswerNum(lim)];
    return {ok:true,engine:'calculus',confidence:'high',entries,answer:entries.at(-1),answerMath:entries.at(-1),steps:['Evaluate the function at each x-value in the table.',`The values approach ${entries.at(-1)}.`],richSteps:[{label:'Table values:',formulas:xs.map((x,i)=>`f(${fmt(x)})=${entries[i]}`)},{label:'Limit:',formulas:[entries.at(-1)]}],debug:{type:'numerical-limit-table'}};
  }
  // ---------- graph matching ----------
  function coloredPaths(dataScript){
    const s=String(dataScript||'');const out=[];let color='black';const re=/(?:stroke\s*=\s*["']([^"']+)["'])|(?:path\s*\(\s*(\[\[[\s\S]*?\]\])\s*\))/g;let m;
    while((m=re.exec(s))){if(m[1]){color=m[1].toLowerCase();continue;}if(m[2]){try{const pts=JSON.parse(m[2]).map(p=>[Number(p[0]),Number(p[1])]).filter(p=>p.every(Number.isFinite));if(pts.length>8)out.push({color,points:pts});}catch(_){}}}
    return out.filter(p=>!['#757575','gray','grey'].includes(p.color));
  }
  function curveError(ast,points){
    if(!ast||!points?.length)return Infinity;let errs=[];const stride=Math.max(1,Math.floor(points.length/40));
    for(let i=0;i<points.length;i+=stride){const [x,y]=points[i],p=evalAst(ast,{x});if(Number.isFinite(p)&&Number.isFinite(y)&&Math.abs(p)<1e8)errs.push(Math.abs(p-y));}
    if(errs.length<4)return Infinity;errs.sort((a,b)=>a-b);return errs[Math.floor(errs.length*0.5)];
  }
  function colorLegend(problem){
    const text=clean(problem?.text||'').toLowerCase();const names=['black','red','blue','green','orange','purple'];const seen=[];
    // Use appearance order; only keep colors that actually appear in the prompt legend.
    const matches=[];for(const n of names){let pos=text.indexOf(n);if(pos>=0)matches.push({n,pos});}matches.sort((a,b)=>a.pos-b.pos);for(const m of matches)seen.push(m.n);return seen;
  }
  function solveGraphMatching(problem){
    const answers=(problem?.answers||[]).filter(a=>String(a.tag||'').toUpperCase()==='SELECT'); if(answers.length<2)return null;
    if(!/match\s+each|match.*graph/i.test(problem?.text||''))return null;
    const graph=(problem.graphs||[])[0];const paths=coloredPaths(graph?.dataScript);if(paths.length<answers.length)return null;
    const legend=colorLegend(problem);if(legend.length<answers.length)return null;
    const entryMap={};const matches=[];const used=new Set();
    for(const a of answers){let ast;try{ast=parseExpr(a.context);}catch(_){return null;}let best=null;
      for(const p of paths){if(used.has(p.color))continue;const err=curveError(ast,p.points);if(!best||err<best.err)best={color:p.color,err};}
      if(!best||!Number.isFinite(best.err)||best.err>0.2)return null;used.add(best.color);const li=legend.indexOf(best.color);if(li<0)return null;
      const opts=(a.options||[]).filter(o=>o.value!==''&&o.value!=='-'&&!/^select|choose$/i.test(o.text));const opt=opts[li];if(!opt)return null;entryMap[a.id]=opt.value;matches.push(`${a.context} → ${best.color}${opt.text?` (${opt.text})`:''}`);
    }
    return {ok:true,engine:'calculus',confidence:'high',entryMap,entries:Object.values(entryMap),answer:matches.join('; '),answerMath:matches.join(' ; '),steps:['Compare each equation’s domain, intercepts, asymptotes, and growth/decay with the plotted curves.',...matches],richSteps:[{label:'Match by curve shape and numerical fit:',formulas:matches}],debug:{type:'graph-match',legend,paths:paths.map(p=>p.color)}};
  }

  // ---------- graph drawing ----------
  function chooseDrawingPoints(ast,graph){
    const xmin=Number(graph?.xmin??-10),xmax=Number(graph?.xmax??10),ymin=Number(graph?.ymin??-10),ymax=Number(graph?.ymax??10);
    const cand=[];for(let x=Math.ceil(xmin);x<=Math.floor(xmax);x++){const y=evalAst(ast,{x});if(Number.isFinite(y)&&y>ymin+0.4&&y<ymax-0.4)cand.push({x,y});}
    let best=null;for(let i=0;i<cand.length;i++)for(let j=i+1;j<cand.length;j++){const a=cand[i],b=cand[j];if(Math.abs(a.x-b.x)<0.9)continue;const dy=Math.abs(a.y-b.y);if(dy<0.45)continue;const score=Math.abs(a.y)+Math.abs(b.y)+0.2*Math.abs(a.x-b.x);if(!best||score<best.score)best={a,b,score};}
    if(!best&&cand.length>=2)best={a:cand[0],b:cand[1]};return best?[best.a,best.b]:null;
  }
  function solveDrawingFunction(problem){
    if(!problem?.widgets?.drawing || !/draw\s+the\s+graph|sketch\s+(?:the\s+)?graph/i.test(problem?.text||''))return null;
    const def=findFunctionDefinition(problem);const graph=(problem.graphs||[])[0];if(!def||!graph)return null;const pts=chooseDrawingPoints(def.ast,graph);if(!pts)return null;
    const tool=/exp|\^x|\^\(x/i.test(def.expr)?'Exponential':/log|ln/i.test(def.expr)?'Logarithm':null;
    if(!tool)return {ok:true,engine:'calculus',confidence:'medium',answer:def.expr,answerMath:`f(x)=${def.expr}`,steps:[`Graph f(x)=${def.expr}.`,`Use key points from the function to place the curve.`],richSteps:[{label:'Function to graph:',formulas:[`f(x)=${def.expr}`]},{label:'Useful points:',formulas:pts.map(p=>`(${fmt(p.x)},${answerNum(p.y)})`)}],drawing:{mode:'points-only',points:pts,answerId:(problem.answers||[]).find(a=>a.type==='hidden')?.id||null}};
    return {ok:true,engine:'calculus',confidence:'high',answer:def.expr,answerMath:`f(x)=${def.expr}`,steps:[`Recognize this as an exponential graph with horizontal asymptote y=0.`,`Use two points on the curve: (${fmt(pts[0].x)}, ${answerNum(pts[0].y)}) and (${fmt(pts[1].x)}, ${answerNum(pts[1].y)}).`,`The extension will use MyOpenMath’s ${tool} drawing tool with those control points.`],richSteps:[{label:'Function:',formulas:[`f(x)=${def.expr}`]},{label:'Control points:',formulas:pts.map(p=>`(${fmt(p.x)},${answerNum(p.y)})`)}],drawing:{mode:'twopoint',tool,points:pts,answerId:(problem.answers||[]).find(a=>a.type==='hidden')?.id||null,graph:{xmin:graph.xmin,xmax:graph.xmax,ymin:graph.ymin,ymax:graph.ymax,xunitlength:graph.xunitlength,yunitlength:graph.yunitlength,ox:graph.ox,oy:graph.oy}}};
  }

  function solve(problem){
    const solvers=[solveCalculusTrueFalse,solveLogConversion,solveLogExpansionCoefficients,solveSimpleExpLogEquation,solveNumericalLimitTable,solveGraphMatching,solveGraphFunctionChoice,solveDrawingFunction,solvePiecewiseValues,solvePiecewiseLimitBundle,solveContinuityParameter,solveRemovableDiscontinuity,solvePiecewiseContinuityChoices,solveIVTMinimumRoots,solveTrigVerticalAsymptoteBundle,solveLimitBundle,solveTangentLine,solveDerivative,solveIntegral,solveGeneralLimit];
    for(const fn of solvers){try{const r=fn(problem);if(r?.ok)return r;}catch(_){} }
    return null;
  }
  self.MOMCalculusEngine={solve,_test:{parseExpr,evalAst,derivative,simplify,astText,integrateSimple,coloredPaths,curveError,solveGraphMatching,solveLogConversion,solveDrawingFunction,parseLimitSpec,normalizeLimitSource,rewriteTexFractions}};
})();
