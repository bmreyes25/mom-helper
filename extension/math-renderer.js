(() => {
  const NS = 'http://www.w3.org/1998/Math/MathML';

  function node(tag, text) {
    const el = document.createElementNS(NS, tag);
    if (text != null) el.textContent = String(text);
    return el;
  }

  function row(...children) {
    const el = node('mrow');
    for (const child of children.flat()) if (child) el.appendChild(child);
    return el;
  }

  function tokenize(input) {
    const text = String(input || '');
    const out = [];
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (/\s/.test(c)) { i++; continue; }
      const num = text.slice(i).match(/^\d+(?:\.\d+)?/);
      if (num) { out.push({ type: 'number', value: num[0] }); i += num[0].length; continue; }
      const ident = text.slice(i).match(/^[A-Za-z][A-Za-z0-9_]*/);
      if (ident) { out.push({ type: 'ident', value: ident[0] }); i += ident[0].length; continue; }
      if ('+-*/^=(),\'<>'.includes(c)) { out.push({ type: c, value: c }); i++; continue; }
      throw new Error(`Unsupported token ${c}`);
    }
    out.push({ type: 'eof', value: '' });
    return out;
  }

  class Parser {
    constructor(text) { this.tokens = tokenize(text); this.i = 0; }
    peek(type) { return this.tokens[this.i]?.type === type; }
    take(type) {
      const t = this.tokens[this.i];
      if (type && t?.type !== type) throw new Error(`Expected ${type}, got ${t?.type}`);
      this.i++;
      return t;
    }
    parse() {
      const expr = this.sequence();
      if (!this.peek('eof')) throw new Error('Unexpected trailing input');
      return expr;
    }
    sequence() {
      let left=this.equality();
      while(this.peek(',')) {
        this.take(',');
        left=row(left,node('mo',','),this.equality());
      }
      return left;
    }
    equality() {
      let left = this.addSub();
      while (this.peek('=') || this.peek('<') || this.peek('>')) {
        const op=this.take().value;
        const inclusive=this.peek('=');
        if(inclusive)this.take('=');
        left = row(left, node('mo', op==='<'?(inclusive?'≤':'<'):op==='>'?(inclusive?'≥':'>'):'='), this.addSub());
      }
      return left;
    }
    addSub() {
      let left = this.mulDiv();
      while (this.peek('+') || this.peek('-')) {
        const op = this.take().value;
        left = row(left, node('mo', op === '-' ? '−' : '+'), this.mulDiv());
      }
      return left;
    }
    mulDiv() {
      let left = this.power();
      while (this.peek('*') || this.peek('/') || this.peek('number') || this.peek('ident') || this.peek('(')) {
        const op=this.peek('*')||this.peek('/')?this.take().value:'*';
        const right = this.power();
        if (op === '/') {
          const frac = node('mfrac');
          frac.append(left, right);
          left = frac;
        } else {
          left = row(left, node('mo', '·'), right);
        }
      }
      return left;
    }
    power() {
      const callable=this.peek('ident');
      let base = this.unary();
      if (this.peek('^')) {
        this.take('^');
        const sup = node('msup');
        sup.append(base, this.power());
        base = sup;
      }
      while(this.peek('\'')){this.take('\'');base=row(base,node('mo','′'));}
      if(callable&&this.peek('(')){
        this.take('(');
        const args=[];
        if(!this.peek(')')){
          args.push(this.equality());
          while(this.peek(',')){this.take(',');args.push(node('mo',','),this.equality());}
        }
        this.take(')');
        base=row(base,node('mo','('),...args,node('mo',')'));
      }
      return base;
    }
    unary() {
      if (this.peek('-')) { this.take('-'); return row(node('mo', '−'), this.unary()); }
      if (this.peek('+')) { this.take('+'); return row(node('mo', '+'), this.unary()); }
      return this.primary();
    }
    primary() {
      if (this.peek('number')) return node('mn', this.take('number').value);
      if (this.peek('ident')) {
        const name = this.take('ident').value;
        if (name === 'undefined') return node('mtext', 'undefined');
        if (name === 'DNE') return node('mtext', 'DNE');
        if (name.toLowerCase() === 'oo') return node('mo', '∞');
        if (name.toLowerCase() === 'sqrt' && this.peek('(')) {
          this.take('(');
          const inside = this.equality();
          this.take(')');
          const root = node('msqrt');
          root.appendChild(inside);
          return root;
        }
        const idMatch = name.match(/^([A-Za-z]+)(\d+)$/);
        let idNode;
        if (idMatch) {
          idNode = node('msub');
          idNode.append(node('mi', idMatch[1]), node('mn', idMatch[2]));
        } else idNode = node('mi', name);

        if (this.peek('(')) {
          this.take('(');
          const args = [];
          if (!this.peek(')')) {
            args.push(this.equality());
            while (this.peek(',')) {
              this.take(',');
              args.push(node('mo', ','), this.equality());
            }
          }
          this.take(')');
          return row(idNode, node('mo', '('), ...args, node('mo', ')'));
        }
        return idNode;
      }
      if (this.peek('(')) {
        this.take('(');
        const parts = [];
        if (!this.peek(')')) {
          parts.push(this.equality());
          while (this.peek(',')) {
            this.take(',');
            parts.push(node('mo', ','), this.equality());
          }
        }
        this.take(')');
        return row(node('mo', '('), ...parts, node('mo', ')'));
      }
      throw new Error('Expected expression');
    }
  }

  function buildMath(expression, display = false) {
    const math = node('math');
    math.setAttribute('display', display ? 'block' : 'inline');
    math.setAttribute('aria-label', String(expression || ''));
    try {
      const source=String(expression||'').trim();
      const limit=source.match(/^lim_?\(\s*([A-Za-z])\s*(?:->|rarr|to)\s*([^)]*)\)\s*(.*?)\s*=\s*(.+)$/i);
      if(limit){
        const under=node('munder');
        under.append(node('mi','lim'),row(node('mi',limit[1]),node('mo','→'),new Parser(limit[2]).parse()));
        math.appendChild(row(under,new Parser(limit[3]).parse(),node('mo','='),new Parser(limit[4]).parse()));
      }else math.appendChild(new Parser(source).parse());
    } catch (_) {
      math.setAttribute('data-mom-fallback','true');
      math.appendChild(node('mtext', String(expression || '')));
    }
    return math;
  }

  function renderFormula(container, expression, display = false) {
    const math=buildMath(expression, display);
    container.replaceChildren(math);
    return math;
  }

  // Step explanations are prose, but often contain short expressions. Render
  // only high-confidence spans as inline MathML; leave ordinary words intact.
  function renderExplanation(container, explanation) {
    const source=String(explanation||'');
    const atom='(?:[A-Za-z][A-Za-z0-9_]*\\([^()]*\\)|[A-Za-z]|\\d+(?:\\.\\d+)?)';
    const powered=`${atom}(?:\\^(?:\\([^()]*\\)|-?\\d+|[A-Za-z]))?`;
    const pattern=new RegExp(`(?<![A-Za-z0-9_])${powered}(?:\\s*[+\\-*/=<>]\\s*${powered})*(?![A-Za-z0-9_])`,'g');
    const parts=[];let cursor=0,match;
    while((match=pattern.exec(source))){
      const expression=match[0],start=match.index,end=start+expression.length;
      const meaningful=/[()+\-*/^=<>]/.test(expression)||/^[xyhftuvwgmknABC]$/.test(expression);
      if(!meaningful)continue;
      const rendered=buildMath(expression);
      if(rendered.getAttribute('data-mom-fallback')==='true')continue;
      if(start>cursor)parts.push(document.createTextNode(source.slice(cursor,start)));
      parts.push(rendered);cursor=end;
    }
    if(cursor<source.length)parts.push(document.createTextNode(source.slice(cursor)));
    container.replaceChildren(...parts);
  }

  self.MOMMath = { buildMath, renderFormula, renderExplanation };
})();
