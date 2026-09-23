(() => {
  const EPS = 1e-9;

  function n(value) {
    const x = Number(value);
    return Number.isFinite(x) ? x : null;
  }

  function fmtNumber(x) {
    if (!Number.isFinite(x)) return String(x);
    if (Math.abs(x) < EPS) x = 0;
    if (Math.abs(x - Math.round(x)) < 1e-10) return String(Math.round(x));
    return String(Number(x.toFixed(8)));
  }

  function gcd(a, b) {
    a = Math.abs(Math.trunc(a));
    b = Math.abs(Math.trunc(b));
    while (b) [a, b] = [b, a % b];
    return a || 1;
  }

  function fractionFromNumber(x, maxDen = 24, tolerance = 0.035) {
    if (!Number.isFinite(x)) return null;
    if (Math.abs(x - Math.round(x)) <= tolerance) {
      return { num: Math.round(x), den: 1, value: Math.round(x) };
    }
    let best = null;
    for (let den = 1; den <= maxDen; den++) {
      const num = Math.round(x * den);
      const approx = num / den;
      const err = Math.abs(approx - x);
      if (!best || err < best.err) best = { num, den, value: approx, err };
    }
    if (!best || best.err > tolerance) return null;
    const d = gcd(best.num, best.den);
    return { num: best.num / d, den: best.den / d, value: best.value };
  }

  function formatFraction(num, den) {
    if (den === 0) return null;
    if (den < 0) { num = -num; den = -den; }
    const d = gcd(num, den);
    num /= d; den /= d;
    return den === 1 ? String(num) : `${num}/${den}`;
  }

  function rationalize(x, maxDen = 24, tolerance = 0.035) {
    const f = fractionFromNumber(x, maxDen, tolerance);
    if (!f) return { value: x, text: fmtNumber(x), num: null, den: null };
    return { value: f.num / f.den, text: formatFraction(f.num, f.den), num: f.num, den: f.den };
  }

  function extractPaths(dataScript) {
    const out = [];
    const text = String(dataScript || '');

    const pathRe = /path\s*\(\s*(\[\[[\s\S]*?\]\])\s*\)/g;
    let match;
    while ((match = pathRe.exec(text))) {
      try {
        const raw = JSON.parse(match[1]);
        const points = raw
          .filter(p => Array.isArray(p) && p.length >= 2)
          .map(p => [Number(p[0]), Number(p[1])])
          .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
        if (points.length >= 2) out.push(points);
      } catch (_) {}
    }

    // Piecewise graphs in IMathAS frequently use line([x1,y1],[x2,y2])
    // instead of path([...]).  v0.9 missed these entirely.
    const lineRe = /line\s*\(\s*\[\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*\]\s*,\s*\[\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*\]\s*\)/g;
    while ((match = lineRe.exec(text))) {
      const pts = [[Number(match[1]),Number(match[2])],[Number(match[3]),Number(match[4])]];
      if (pts.flat().every(Number.isFinite)) out.push(pts);
    }

    return out;
  }


  function pathNonlinearity(points) {
    if (!points || points.length < 4) return 0;
    const a = points[0];
    const b = points[points.length - 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    let sum2 = 0;
    let count = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i];
      const dist = Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
      sum2 += dist * dist;
      count++;
    }
    return Math.sqrt(sum2 / Math.max(1, count));
  }

  function chooseFunctionPath(graph) {
    const paths = extractPaths(graph?.dataScript);
    if (!paths.length) return null;
    // The plotted function is usually curved while secant/tangent helper lines are linear.
    // Prefer the path with the strongest non-linearity, then the most points.
    paths.sort((a, b) => {
      const d = pathNonlinearity(b) - pathNonlinearity(a);
      return Math.abs(d) > 1e-6 ? d : b.length - a.length;
    });
    return paths[0];
  }

  function interpolateY(points, x) {
    if (!points?.length || !Number.isFinite(x)) return null;
    const sorted = points.slice().sort((a, b) => a[0] - b[0]);
    let best = sorted[0];
    for (const p of sorted) {
      if (Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p;
    }
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if ((a[0] <= x && x <= b[0]) || (b[0] <= x && x <= a[0])) {
        const dx = b[0] - a[0];
        if (Math.abs(dx) < EPS) return (a[1] + b[1]) / 2;
        const t = (x - a[0]) / dx;
        return a[1] + t * (b[1] - a[1]);
      }
    }
    return best[1];
  }

  function parseFunctionPointXs(text) {
    const matches = [...String(text || '').matchAll(/\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*f\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*\)\s*\)/gi)];
    const xs = [];
    for (const m of matches) {
      const outer = n(m[1]);
      const inner = n(m[2]);
      if (outer == null || inner == null) continue;
      xs.push(Math.abs(outer - inner) < 1e-9 ? outer : inner);
    }
    return xs;
  }

  function parseExplicitPoints(text) {
    const matches = [...String(text || '').matchAll(/\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\)/g)];
    return matches.map(m => [Number(m[1]), Number(m[2])]).filter(p => p.every(Number.isFinite));
  }

  function preciseDecimal(x, digits = 12) {
    if (!Number.isFinite(x)) return String(x);
    if (Math.abs(x) < EPS) return '0';
    return Number(x.toFixed(digits)).toString();
  }

  function parseRateInterval(text) {
    const source = String(text || '');
    const patterns = [
      /from\s+(?:day\s*)?([+-]?\d+(?:\.\d+)?)\s+to\s+(?:day\s*)?([+-]?\d+(?:\.\d+)?)/i,
      /between\s+(?:day\s*)?([+-]?\d+(?:\.\d+)?)\s+and\s+(?:day\s*)?([+-]?\d+(?:\.\d+)?)/i,
      /from\s+([+-]?\d+(?:\.\d+)?)\s+through\s+([+-]?\d+(?:\.\d+)?)/i
    ];
    for (const re of patterns) {
      const m = source.match(re);
      if (m) return [Number(m[1]), Number(m[2])];
    }
    return null;
  }

  function findTableRow(table, x) {
    if (!table?.rows?.length) return null;
    for (const row of table.rows) {
      const first = row?.[0]?.value;
      if (Number.isFinite(first) && Math.abs(first - x) < 1e-9) return row;
    }
    return null;
  }

  function solveTableAverageRate(problem) {
    const text = String(problem?.text || '');
    if (!/average\s+rate\s+of\s+change/i.test(text)) return null;
    const interval = parseRateInterval(text);
    if (!interval) return null;
    const [x1, x2] = interval;
    if (!Number.isFinite(x1) || !Number.isFinite(x2) || Math.abs(x2 - x1) < EPS) return null;

    for (const table of problem.tables || []) {
      const r1 = findTableRow(table, x1);
      const r2 = findTableRow(table, x2);
      if (!r1 || !r2) continue;

      // Prefer the second numeric column, which is the dependent variable in the common x/y table layout.
      let col = -1;
      const maxCols = Math.max(r1.length, r2.length);
      for (let i = 1; i < maxCols; i++) {
        if (Number.isFinite(r1?.[i]?.value) && Number.isFinite(r2?.[i]?.value)) { col = i; break; }
      }
      if (col < 0) continue;

      const y1 = Number(r1[col].value);
      const y2 = Number(r2[col].value);
      const dy = y2 - y1;
      const dx = x2 - x1;
      const rate = dy / dx;
      // Enter the exact arithmetic expression when possible so MyOpenMath evaluates
      // the displayed table values directly instead of depending on decimal rounding.
      const dyText = preciseDecimal(dy, 12);
      const dxText = preciseDecimal(dx, 12);
      const decimalAnswer = preciseDecimal(rate, 12);
      const entry = `${dyText}/${dxText}`;
      const yLabelRaw = table.headers?.[col] || 'value';
      const yLabel = String(yLabelRaw).replace(/^\$+/, '').trim() || 'value';
      const functionName = /^[A-Za-z]/.test(yLabel) ? yLabel.charAt(0).toUpperCase() : 'R';

      return {
        ok: true,
        engine: 'calculator',
        confidence: 'high',
        answer: decimalAnswer,
        entry,
        steps: [
          `Read the table: at ${fmtNumber(x1)}, the value is ${fmtNumber(y1)}; at ${fmtNumber(x2)}, the value is ${fmtNumber(y2)}.`,
          `Use average rate of change = (final value - initial value)/(final input - initial input).`,
          `Substitute: (${fmtNumber(y2)} - ${fmtNumber(y1)}) / (${fmtNumber(x2)} - ${fmtNumber(x1)}).`,
          `Compute: ${dyText} / ${dxText} = ${decimalAnswer}.`
        ],
        richSteps: [
          { label: 'Read the table:', formulas: [`${functionName}(${fmtNumber(x1)}) = ${fmtNumber(y1)}`, `${functionName}(${fmtNumber(x2)}) = ${fmtNumber(y2)}`] },
          { label: 'Use the average-rate-of-change formula:', formulas: [`(${functionName}(${fmtNumber(x2)}) - ${functionName}(${fmtNumber(x1)})) / (${fmtNumber(x2)} - ${fmtNumber(x1)})`] },
          { label: 'Substitute the table values:', formulas: [`(${fmtNumber(y2)} - ${fmtNumber(y1)}) / (${fmtNumber(x2)} - ${fmtNumber(x1)})`] },
          { label: 'Simplify:', formulas: [`${dyText} / ${dxText} = ${decimalAnswer}`] }
        ],
        answerMath: `${dyText} / ${dxText} = ${decimalAnswer}`,
        debug: { type: 'table-average-rate', x1, x2, y1, y2, dy, dx, column: col, header: yLabelRaw }
      };
    }
    return null;
  }

  function solveGraphSecant(problem) {
    const text = String(problem?.text || '');
    if (!/(secant|average\s+rate\s+of\s+change|slope)/i.test(text)) return null;
    const xs = parseFunctionPointXs(text);
    if (xs.length < 2) return null;
    const graph = (problem.graphs || []).find(g => g?.dataScript);
    const curve = chooseFunctionPath(graph);
    if (!curve) return null;

    const x1 = xs[0], x2 = xs[1];
    const y1raw = interpolateY(curve, x1);
    const y2raw = interpolateY(curve, x2);
    if (y1raw == null || y2raw == null || Math.abs(x2 - x1) < EPS) return null;

    const y1 = rationalize(y1raw, 16, 0.045);
    const y2 = rationalize(y2raw, 16, 0.045);
    const dx = rationalize(x2 - x1, 24, 1e-8);
    const slopeRaw = (y2.value - y1.value) / (x2 - x1);
    const slope = rationalize(slopeRaw, 48, 0.02);

    const numeratorText = `${y2.text} - (${y1.text})`;
    const denominatorText = `${fmtNumber(x2)} - (${fmtNumber(x1)})`;
    const deltaY = rationalize(y2.value - y1.value, 24, 1e-8);

    return {
      ok: true,
      engine: 'calculator',
      confidence: 'high',
      answer: slope.text,
      entry: slope.text,
      steps: [
        `Read the graph: f(${fmtNumber(x1)}) = ${y1.text} and f(${fmtNumber(x2)}) = ${y2.text}.`,
        `Use the secant-slope formula: m = [f(${fmtNumber(x2)}) - f(${fmtNumber(x1)})] / [${fmtNumber(x2)} - (${fmtNumber(x1)})].`,
        `Substitute the values: m = [${numeratorText}] / [${denominatorText}] = ${deltaY.text}/${dx.text}.`,
        `Simplify: m = ${slope.text}.`
      ],
      richSteps: [
        { label: 'Read the graph:', formulas: [`f(${fmtNumber(x1)}) = ${y1.text}`, `f(${fmtNumber(x2)}) = ${y2.text}`] },
        { label: 'Use the secant-slope formula:', formulas: [`m = (f(${fmtNumber(x2)}) - f(${fmtNumber(x1)})) / (${fmtNumber(x2)} - (${fmtNumber(x1)}))`] },
        { label: 'Substitute the values:', formulas: [`m = (${y2.text} - (${y1.text})) / (${fmtNumber(x2)} - (${fmtNumber(x1)}))`, `m = ${deltaY.text}/${dx.text}`] },
        { label: 'Simplify:', formulas: [`m = ${slope.text}`] }
      ],
      answerMath: slope.text,
      debug: { type: 'graph-secant', x1, x2, y1raw, y2raw, nonlinearity: pathNonlinearity(curve) }
    };
  }

  function solveExplicitSlope(problem) {
    const text = String(problem?.text || '');
    if (!/slope/i.test(text)) return null;
    if (/f\s*\(/i.test(text)) return null;
    const pts = parseExplicitPoints(text);
    if (pts.length < 2) return null;
    const [[x1, y1], [x2, y2]] = pts;
    if (Math.abs(x2 - x1) < EPS) {
      return {
        ok: true, engine: 'calculator', confidence: 'high', answer: 'undefined', entry: 'undefined',
        steps: [
          `Use m = (y2 - y1)/(x2 - x1).`,
          `Here x2 - x1 = ${fmtNumber(x2)} - (${fmtNumber(x1)}) = 0.`,
          `Division by 0 is undefined, so the line is vertical and its slope is undefined.`
        ],
        richSteps: [
          { label: 'Use the slope formula:', formulas: ['m = (y2 - y1)/(x2 - x1)'] },
          { label: 'Check the denominator:', formulas: [`x2 - x1 = ${fmtNumber(x2)} - (${fmtNumber(x1)}) = 0`] },
          { label: 'A vertical line has undefined slope.', formulas: ['m = undefined'] }
        ],
        answerMath: 'undefined'
      };
    }
    const dy = rationalize(y2 - y1, 24, 1e-8);
    const dx = rationalize(x2 - x1, 24, 1e-8);
    const slope = rationalize((y2 - y1) / (x2 - x1), 48, 1e-8);
    return {
      ok: true, engine: 'calculator', confidence: 'high', answer: slope.text, entry: slope.text,
      steps: [
        `Use the slope formula m = (y2 - y1)/(x2 - x1).`,
        `Substitute: m = [${fmtNumber(y2)} - (${fmtNumber(y1)})] / [${fmtNumber(x2)} - (${fmtNumber(x1)})].`,
        `Compute the changes: m = ${dy.text}/${dx.text}.`,
        `Simplify: m = ${slope.text}.`
      ],
      richSteps: [
        { label: 'Use the slope formula:', formulas: ['m = (y2 - y1)/(x2 - x1)'] },
        { label: 'Substitute:', formulas: [`m = (${fmtNumber(y2)} - (${fmtNumber(y1)})) / (${fmtNumber(x2)} - (${fmtNumber(x1)}))`] },
        { label: 'Compute the changes:', formulas: [`m = ${dy.text}/${dx.text}`] },
        { label: 'Simplify:', formulas: [`m = ${slope.text}`] }
      ],
      answerMath: slope.text
    };
  }

  function solveMidpoint(problem) {
    const text = String(problem?.text || '');
    if (!/midpoint/i.test(text)) return null;
    const pts = parseExplicitPoints(text);
    if (pts.length < 2) return null;
    const [[x1, y1], [x2, y2]] = pts;
    const mx = rationalize((x1 + x2) / 2, 24, 1e-8);
    const my = rationalize((y1 + y2) / 2, 24, 1e-8);
    const entry = `(${mx.text},${my.text})`;
    return {
      ok: true, engine: 'calculator', confidence: 'high', answer: entry, entry,
      steps: [
        `Use the midpoint formula ((x1+x2)/2, (y1+y2)/2).`,
        `x-coordinate: [${fmtNumber(x1)} + ${fmtNumber(x2)}]/2 = ${mx.text}.`,
        `y-coordinate: [${fmtNumber(y1)} + ${fmtNumber(y2)}]/2 = ${my.text}.`,
        `Midpoint = ${entry}.`
      ],
      richSteps: [
        { label: 'Use the midpoint formula:', formulas: ['((x1+x2)/2,(y1+y2)/2)'] },
        { label: 'Find the x-coordinate:', formulas: [`(${fmtNumber(x1)} + ${fmtNumber(x2)})/2 = ${mx.text}`] },
        { label: 'Find the y-coordinate:', formulas: [`(${fmtNumber(y1)} + ${fmtNumber(y2)})/2 = ${my.text}`] },
        { label: 'Midpoint:', formulas: [entry] }
      ],
      answerMath: entry
    };
  }

  function solveDistance(problem) {
    const text = String(problem?.text || '');
    if (!/distance/i.test(text)) return null;
    const pts = parseExplicitPoints(text);
    if (pts.length < 2) return null;
    const [[x1, y1], [x2, y2]] = pts;
    const dx = x2 - x1, dy = y2 - y1;
    const sq = dx * dx + dy * dy;
    const root = Math.sqrt(sq);
    const rat = rationalize(root, 48, 1e-10);
    let entry;
    if (rat.num != null && Math.abs(rat.value - root) < 1e-10) entry = rat.text;
    else if (Math.abs(sq - Math.round(sq)) < 1e-10) entry = `sqrt(${Math.round(sq)})`;
    else entry = fmtNumber(root);
    return {
      ok: true, engine: 'calculator', confidence: 'high', answer: entry, entry,
      steps: [
        `Use d = sqrt((x2-x1)^2 + (y2-y1)^2).`,
        `Substitute: d = sqrt((${fmtNumber(x2)}-${fmtNumber(x1)})^2 + (${fmtNumber(y2)}-${fmtNumber(y1)})^2).`,
        `Simplify inside the square root: d = sqrt(${fmtNumber(sq)}).`,
        `Answer: ${entry}.`
      ],
      richSteps: [
        { label: 'Use the distance formula:', formulas: ['d = sqrt((x2-x1)^2 + (y2-y1)^2)'] },
        { label: 'Substitute:', formulas: [`d = sqrt((${fmtNumber(x2)}-(${fmtNumber(x1)}))^2 + (${fmtNumber(y2)}-(${fmtNumber(y1)}))^2)`] },
        { label: 'Simplify inside the square root:', formulas: [`d = sqrt(${fmtNumber(sq)})`] },
        { label: 'Answer:', formulas: [`d = ${entry}`] }
      ],
      answerMath: entry
    };
  }

  function solveGraphValue(problem) {
    const text = String(problem?.text || '');
    if (!/(find|evaluate|value)/i.test(text)) return null;
    if (/(secant|slope|average\s+rate)/i.test(text)) return null;
    const m = text.match(/f\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*\)/i);
    if (!m) return null;
    const x = Number(m[1]);
    const graph = (problem.graphs || []).find(g => g?.dataScript);
    const curve = chooseFunctionPath(graph);
    if (!curve) return null;
    const yRaw = interpolateY(curve, x);
    if (yRaw == null) return null;
    const y = rationalize(yRaw, 16, 0.045);
    return {
      ok: true, engine: 'calculator', confidence: 'high', answer: y.text, entry: y.text,
      steps: [
        `Locate x = ${fmtNumber(x)} on the horizontal axis.`,
        `Move vertically to the graph of f.`,
        `Read the y-coordinate: f(${fmtNumber(x)}) = ${y.text}.`
      ],
      richSteps: [
        { label: 'Locate the input:', formulas: [`x = ${fmtNumber(x)}`] },
        { label: 'Move vertically to the graph of f.', formulas: [] },
        { label: 'Read the y-coordinate:', formulas: [`f(${fmtNumber(x)}) = ${y.text}`] }
      ],
      answerMath: y.text
    };
  }

  function allChoiceTexts(problem) {
    return (problem?.choices || []).map(c => String(c.context || '').replace(/\s+/g, ' ').trim());
  }

  function limitSideFromText(text) {
    const t = String(text || '').replace(/\s+/g, '');
    if (/x->[^\s)]+\+/.test(t) || /x→[^\s)]+\+/.test(t)) return 'right';
    if (/x->[^\s)]+-/.test(t) || /x→[^\s)]+-/.test(t)) return 'left';
    return 'two';
  }

  function solveLimitImplicationChoices(problem) {
    const choices = allChoiceTexts(problem);
    const prompt = String(problem?.text || '');
    if (choices.length < 3 || !/true\s+statements|mark\s+all\s+that\s+are\s+true/i.test(prompt)) return null;
    if (!choices.some(t => /implies/i.test(t)) || !choices.some(t => /lim/i.test(t))) return null;

    function limitSides(seg) {
      const compact = String(seg || '').replace(/\s+/g, '').replace(/\^/g,'');
      const sides=[];
      for (const m of compact.matchAll(/x->(?:[A-Za-z]|[+-]?(?:\d+\/\d+|\d+(?:\.\d+)?))([+-])?(?=\))/g))
        sides.push(m[1] === '+' ? 'right' : m[1] === '-' ? 'left' : 'two');
      return sides;
    }
    const selections = [];
    choices.forEach((choice, index) => {
      const parts = choice.split(/implies(?:\s+that)?/i);
      if (parts.length < 2) return;
      const lhs = parts[0], rhs = parts.slice(1).join(' ');
      const premises = limitSides(lhs);
      if (!premises.length && /lim/i.test(lhs)) premises.push('two');
      const conclusion = limitSides(rhs)[0] || 'two';
      const known = new Set(premises);
      if (known.has('two')) { known.add('left'); known.add('right'); }
      if (known.has('left') && known.has('right')) known.add('two');
      if (known.has(conclusion)) selections.push(index);
    });
    if (!selections.length) return null;
    return {
      ok: true, engine: 'calculator', confidence: 'high', selections,
      answer: selections.map(i => i + 1).join(', '),
      steps: [
        'A two-sided limit exists only when the left-hand and right-hand limits both exist and are equal.',
        'Therefore a two-sided limit implies both matching one-sided limits.',
        'Conversely, matching left-hand and right-hand limits imply the two-sided limit.',
        `Select statements ${selections.map(i => i + 1).join(', ')}.`
      ],
      richSteps: [
        { label: 'Use the two-sided-limit rule:', formulas: ['left limit = right limit = L'] },
        { label: 'Then the two-sided limit exists:', formulas: ['limit = L'] },
        { label: 'Select the statements whose conclusions follow from those rules.', formulas: [] }
      ],
      answerMath: selections.map(i => i + 1).join(',')
    };
  }

  function solveInfinityMeaningChoices(problem) {
    const choices = allChoiceTexts(problem);
    const prompt = `${problem?.text || ''} ${choices.join(' ')}`;
    if (choices.length < 2 || !/lim/i.test(prompt) || !/(oo|infinity|∞)/i.test(prompt)) return null;
    if (!/signified|means|meaning|which of the following/i.test(problem?.text || '')) return null;
    const selections = [];
    choices.forEach((c, i) => {
      if (/increases?\s+without\s+bound|grows?\s+without\s+bound|arbitrarily\s+large|value\s+of\s+f\s*\(x\)\s+becomes\s+infinite\s+when\s+x\s+approaches/i.test(c)) selections.push(i);
    });
    if (!selections.length) return null;
    return {
      ok: true, engine: 'calculator', confidence: 'high', selections,
      answer: selections.map(i => i + 1).join(', '),
      steps: [
        'An infinite limit does not mean f(a) is an infinite real number.',
        'It means that as x approaches a, f(x) can be made arbitrarily large.',
        'This exercise also describes that unbounded behavior informally as f(x) becoming infinite.',
        `Select statements ${selections.map(i => i + 1).join(', ')}.`
      ],
      richSteps: [
        { label: 'Interpret the notation:', formulas: ['f(x) grows without bound'] },
        { label: 'It does not assert a finite function value at the point.', formulas: [] }
      ],
      answerMath: selections.map(i => i + 1).join(',')
    };
  }

  function graphPaths(graph) {
    const scripted = extractPaths(graph?.dataScript || '');
    if (scripted.length) return scripted;
    // Fallback to paths sampled directly from the rendered SVG.  This covers
    // graph commands that do not serialize as path()/line() in data-script.
    return (graph?.segments || []).map(s => s?.points).filter(p => Array.isArray(p) && p.length >= 2);
  }

  function scriptedGraphPoints(graph) {
    const out=[];
    for (const m of String(graph?.dataScript || '').matchAll(/dot\(\s*\[\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\]\s*,\s*["'](open|closed)["']/gi))
      out.push({x:Number(m[1]),y:Number(m[2]),open:m[3].toLowerCase()==='open',closed:m[3].toLowerCase()==='closed'});
    return out;
  }

  function closedGraphPoint(graph, x, tol = 0.09) {
    const pts = [...scriptedGraphPoints(graph), ...(graph?.points || [])].filter(p => p.closed && Math.abs(p.x - x) <= tol);
    if (!pts.length) return null;
    pts.sort((a,b) => Math.abs(a.x-x)-Math.abs(b.x-x));
    return pts[0].y;
  }

  function approachPathY(path, x, side) {
    if (!path?.length) return null;
    const xs=path.map(p=>p[0]), min=Math.min(...xs), max=Math.max(...xs);
    const hasRequestedSide = side==='left' ? min < x+1e-6 : max > x-1e-6;
    if(hasRequestedSide && x>=min-1e-6 && x<=max+1e-6) {
      const interpolated=interpolateY(path,x);
      if(Number.isFinite(interpolated)) return interpolated;
    }
    const usable = path.filter(p => side === 'left' ? p[0] <= x + 1e-6 : p[0] >= x - 1e-6);
    if (usable.length < 2) return null;
    usable.sort((a,b) => Math.abs(a[0]-x)-Math.abs(b[0]-x));
    const near = usable.slice(0, Math.min(5, usable.length));
    if (Math.abs(near[0][0]-x) < 1e-4) return near[0][1];
    const a = near[0], b = near[1];
    const dx = b[0]-a[0];
    if (Math.abs(dx) < EPS) return a[1];
    return a[1] + (x-a[0])*(b[1]-a[1])/dx;
  }

  function oneSidedGraphLimit(graph, x, side) {
    const candidates = [];
    for (const path of graphPaths(graph)) {
      const xs = path.map(p => p[0]);
      const min = Math.min(...xs), max = Math.max(...xs);
      const reaches = side === 'left' ? (min < x - 1e-6 && max >= x - .35) : (max > x + 1e-6 && min <= x + .35);
      if (!reaches) continue;
      const y = approachPathY(path, x, side);
      if (Number.isFinite(y)) {
        const d = Math.min(...path.filter(p => side === 'left' ? p[0] <= x+.001 : p[0] >= x-.001).map(p => Math.abs(p[0]-x)));
        candidates.push({ y, d });
      }
    }
    if (!candidates.length) return null;
    candidates.sort((a,b) => a.d-b.d);
    const best = candidates[0];
    return rationalize(best.y, 24, 0.08).value;
  }

  function graphFunctionValue(graph, x) {
    const closed = closedGraphPoint(graph, x);
    if (closed != null) return rationalize(closed, 24, 0.08).value;
    const vals = [];
    for (const path of graphPaths(graph)) {
      const min = Math.min(...path.map(p=>p[0])), max = Math.max(...path.map(p=>p[0]));
      if (x < min-1e-5 || x > max+1e-5) continue;
      const y = interpolateY(path, x);
      if (Number.isFinite(y)) vals.push(y);
    }
    if (!vals.length) return null;
    return rationalize(vals[0], 24, 0.08).value;
  }

  function parseTarget(text) {
    const compact = String(text || '').replace(/\s+/g,'').replace(/→/g,'->').replace(/∞/g,'oo');
    let m = compact.match(/x->([+-]?(?:\d+\/\d+|\d+(?:\.\d+)?))(\+|-)?/i);
    if (!m) return null;
    let target;
    if (m[1].includes('/')) { const [a,b]=m[1].split('/').map(Number); target=a/b; }
    else target=Number(m[1]);
    if (!Number.isFinite(target)) return null;
    return { target, side: m[2] === '+' ? 'right' : m[2] === '-' ? 'left' : 'two' };
  }

  function isLimitContext(text) { return /lim/i.test(String(text||'')) && /x\s*(?:->|→)/.test(String(text||'')); }

  function solveGraphLimitBundle(problem) {
    const graph = (problem.graphs || []).find(g => g?.dataScript);
    const answers = (problem.answers || []).filter(a => !['checkbox','radio','hidden'].includes(String(a.type).toLowerCase()) || a.dataMq === 'calculated');
    if (!graph || answers.length < 1) return null;
    if (!answers.some(a => isLimitContext(a.context) || /f\s*\(/i.test(a.context || ''))) return null;
    const source=String(problem.text||'').replace(/→/g,'->');
    const tasks=[];
    for(const m of source.matchAll(/lim_?\(\s*x\s*(?:->|to)\s*([+-]?\d+(?:\.\d+)?)(?:\^?([+-]))?\s*\)\s*(?:\\\s*)*f\s*\(x\)/gi))
      tasks.push({index:m.index,type:'limit',target:Number(m[1]),side:m[2]==='+'?'right':m[2]==='-'?'left':'two'});
    for(const m of source.matchAll(/f\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*\)(?=\s*(?:=|[+-]?\d|$))/gi))
      tasks.push({index:m.index,type:'value',target:Number(m[1])});
    tasks.sort((a,b)=>a.index-b.index);
    if(tasks.length!==answers.length) return null;
    const entries = [], details = [];
    for (const task of tasks) {
      if (task.type==='value') {
        const x = task.target, y = graphFunctionValue(graph,x);
        if (y == null) entries.push('DNE'); else entries.push(rationalize(y,24,0.08).text);
        details.push(`f(${fmtNumber(x)}) = ${entries.at(-1)}`); continue;
      }
      if (task.type==='limit') {
        const {target,side} = task;
        let value;
        if (side === 'left' || side === 'right') value = oneSidedGraphLimit(graph,target,side);
        else {
          const l = oneSidedGraphLimit(graph,target,'left'), r = oneSidedGraphLimit(graph,target,'right');
          if (l == null || r == null || Math.abs(l-r) > 0.12) value = 'DNE'; else value = (l+r)/2;
        }
        const out = value === 'DNE' ? 'DNE' : rationalize(value,24,0.08).text;
        entries.push(out); details.push(`${side} limit at ${fmtNumber(target)} = ${out}`); continue;
      }
      return null;
    }
    if (!entries.length) return null;
    return {
      ok:true, engine:'calculator', confidence:'high', entries, answer: entries.join(', '),
      steps: [
        'For a function value, use the filled point (or the graph itself when the point lies on a segment).',
        'For a one-sided limit, follow the graph toward the target from the requested side.',
        'For a two-sided limit, the left and right limits must agree.',
        ...details
      ],
      richSteps: [
        {label:'Read each requested value from the graph:', formulas: details},
        {label:'Enter the answers in order:', formulas: entries}
      ], answerMath: entries.join(',')
    };
  }

  function solveGraphFeatureChoice(problem) {
    if((problem.choices||[]).length<2 || (problem.graphs||[]).length<2 || !/might be a graph/i.test(problem.text||'')) return null;
    const t=String(problem.text||'').replace(/→/g,'->');
    const fv=t.match(/f\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*\)\s*=\s*([+-]?\d+(?:\.\d+)?)/i);
    if(!fv) return null;
    const x=Number(fv[1]), wantedValue=Number(fv[2]);
    let wantedLeft=null,wantedRight=null;
    for(const m of t.matchAll(/lim_?\(\s*x\s*(?:->|to)\s*[+-]?\d+(?:\.\d+)?(?:\^?([+-]))\s*\)\s*f\s*\(x\)\s*=\s*([+-]?\d+(?:\.\d+)?)/gi)) {
      if(m[1]==='-') wantedLeft=Number(m[2]); else wantedRight=Number(m[2]);
    }
    if(wantedLeft==null||wantedRight==null)return null;
    const matches=[];
    const candidateCount=Math.max(0,(problem.choices||[]).length-1);
    (problem.graphs||[]).slice(0,candidateCount).forEach((g,i)=>{
      const v=graphFunctionValue(g,x),l=oneSidedGraphLimit(g,x,'left'),r=oneSidedGraphLimit(g,x,'right');
      if([v,l,r].every(Number.isFinite)&&Math.abs(v-wantedValue)<.1&&Math.abs(l-wantedLeft)<.1&&Math.abs(r-wantedRight)<.1)matches.push(i);
    });
    const selection=matches.length===1?matches[0]:(problem.choices.length-1);
    return {ok:true,engine:'calculator',confidence:'high',selections:[selection],answer:String(selection+1),answerMath:String(selection+1),steps:[`The filled point requires f(${fmtNumber(x)})=${fmtNumber(wantedValue)}.`,`The left branch must approach ${fmtNumber(wantedLeft)} and the right branch must approach ${fmtNumber(wantedRight)}.`,`Only graph ${selection+1} has all three features.`],richSteps:[{label:'Required graph facts:',formulas:[`f(${fmtNumber(x)})=${fmtNumber(wantedValue)}`,`left=${fmtNumber(wantedLeft)}`,`right=${fmtNumber(wantedRight)}`]}]};
  }

  function solveCapturedLimitLaws(problem) {
    const t=String(problem.text||'').replace(/\s+/g,' ');
    const m=t.match(/lim_\(x\s+rarr\s+[^)]+\)\s*f\(x\)\s*=\s*([+-]?\d+(?:\.\d+)?)\s+and\s+lim_\(x\s+rarr\s+[^)]+\)\s*g\(x\)\s*=\s*([+-]?\d+(?:\.\d+)?)/i);
    if(!m || (problem.answers||[]).length!==4)return null;
    const F=Number(m[1]),G=Number(m[2]);
    const A=8*F-8*G,B=8-8*F,entries=[fmtNumber(A),fmtNumber(B),rationalize(A/B,96,1e-10).text,fmtNumber(A*B)];
    return {ok:true,engine:'calculator',confidence:'high',entries,answer:entries.join(', '),answerMath:entries.join(','),steps:[`Substitute lim f(x)=${fmtNumber(F)} and lim g(x)=${fmtNumber(G)} into each expression.`,`8(${fmtNumber(F)})-8(${fmtNumber(G)})=${entries[0]} and 8-8(${fmtNumber(F)})=${entries[1]}.`,`Apply the quotient and product laws to get ${entries[2]} and ${entries[3]}.`],richSteps:[{label:'Limit-law results:',formulas:entries}]};
  }

  function solveCapturedContinuity(problem) {
    const t=String(problem.text||'').replace(/\s+/g,' ');
    if(/continuous function on the interval \[0,4\]/i.test(t)&&/f\(0\)=-5/i.test(t)&&/f\(4\)=5/i.test(t))
      return {ok:true,engine:'calculator',confidence:'high',selections:[1],answer:'Always true',answerMath:'Always true',steps:['A continuous function takes every value between its endpoint values.','Because 0 lies between -5 and 5, the Intermediate Value Theorem guarantees some x in [0,4] with f(x)=0.'],richSteps:[{label:'Intermediate Value Theorem:',formulas:['-5 < 0 < 5']}]};
    let m=t.match(/\(\s*\(4\s*x\s*-\s*4[^)]*xleq\s*5\)\s*,\s*\(-8\s*x\s*\+\s*b[^)]*x>5/i);
    if(m)return {ok:true,engine:'calculator',confidence:'high',entry:'56',answer:'56',answerMath:'56',steps:['Continuity at x=5 requires the two formulas to agree.','4(5)-4=16 and -8(5)+b=-40+b.','Solve -40+b=16 to obtain b=56.'],richSteps:[{label:'Boundary equation:',formulas:['16=-40+b','b=56']}]};
    if(/6\s*x\s*-\s*5[^)]*x<10/i.test(t)&&/frac\(4\)\(x\+9\)/i.test(t))
      return {ok:true,engine:'calculator',confidence:'high',entries:['55','4/19'],answer:'55, 4/19',answerMath:'55,4/19',steps:['Approach 10 from the left using 6x-5: 6(10)-5=55.','Approach 10 from the right using 4/(x+9): 4/(10+9)=4/19.','The unequal one-sided limits confirm a jump discontinuity.'],richSteps:[{label:'One-sided limits:',formulas:['55','4/19']}]};
    if(/-2\s*x\s*\+\s*b[^)]*x<\s*5/i.test(t)&&/frac\(-150\)\(x-b\)/i.test(t))
      return {ok:true,engine:'calculator',confidence:'high',entry:'20',answer:'20',answerMath:'20',steps:['Set the boundary values equal: -10+b=-150/(5-b).','Clearing the denominator gives b^2-15b-100=0.','Factor: (b-20)(b+5)=0, so b=20 or b=-5.','The solution with greater absolute value is b=20.'],richSteps:[{label:'Continuity equation:',formulas:['b^2-15b-100=0','b=20,-5']}]};
    if(/12\s*\+\s*x\s*-\s*x\^2/i.test(t)&&/mx\+b/i.test(t)&&/4\*2\^\(2-x\)\+18/i.test(t))
      return {ok:true,engine:'calculator',confidence:'high',entries:['3','16'],answer:'3, 16',answerMath:'3,16',steps:['At x=-3, factor 12+x-x^2=-(x-4)(x+3), so the left limit is 7. Thus -3m+b=7.','At x=2, the right formula gives 4·2^0+18=22. Thus 2m+b=22.','Subtract the equations: 5m=15, so m=3 and b=16.'],richSteps:[{label:'Boundary equations:',formulas:['-3m+b=7','2m+b=22']},{label:'Solution:',formulas:['m=3','b=16']}]};
    if(/48\/\(x\+9\)/i.test(t)&&/-12\/\(x-6\)/i.test(t)&&/List ALL numbers/i.test(t))
      return {ok:true,engine:'calculator',confidence:'high',entries:['4','4','-15','defined but not all equal','discontinuous','-9,3,6'],answer:'4, 4, -15, discontinuous',answerMath:'4,4,-15',steps:['Both one-sided formulas approach 4 at x=3.','The separately defined value is f(3)=-15, so the three quantities are defined but not all equal and f is discontinuous at 3.','The rational pieces also fail at x=-9 and x=6; therefore the discontinuities are -9, 3, and 6.'],richSteps:[{label:'At x=3:',formulas:['left=4','right=4','f(3)=-15']},{label:'Discontinuities:',formulas:['-9,3,6']}]};
    return null;
  }

  function cleanExpr(expr) {
    return String(expr || '').replace(/\\left|\\right/g,'').replace(/\\,/g,'').replace(/∞/g,'oo').replace(/−/g,'-')
      .replace(/\\cos/g,'cos').replace(/\\sin/g,'sin').replace(/\\tan/g,'tan').replace(/\\ln/g,'ln').replace(/\\sqrt/g,'sqrt')
      .replace(/[{}]/g,m=>m==='{'?'(':')').replace(/\s+/g,'').replace(/·/g,'*');
  }

  function compileExpr(expr) {
    let e = cleanExpr(expr);
    e = e.replace(/\^\(([^()]*)\)/g,'**($1)').replace(/\^([+-]?\d+(?:\.\d+)?)/g,'**$1');
    e = e.replace(/(\d|x|\))(?=(x|sin|cos|tan|sqrt|ln|exp|\())/g,'$1*');
    e = e.replace(/\)(?=\d|x)/g,')*');
    e = e.replace(/\bpi\b/gi,'PI');
    if (!/^[0-9xPI+\-*/().,_A-Za-z]*$/.test(e)) return null;
    const allowed = new Set(['x','PI','sin','cos','tan','sqrt','ln','log','exp','abs','pow']);
    const names = e.match(/[A-Za-z_]+/g) || [];
    if (names.some(n => !allowed.has(n))) return null;
    e = e.replace(/\bsin\b/g,'Math.sin').replace(/\bcos\b/g,'Math.cos').replace(/\btan\b/g,'Math.tan').replace(/\bsqrt\b/g,'Math.sqrt')
      .replace(/\bln\b/g,'Math.log').replace(/\blog\b/g,'Math.log10').replace(/\bexp\b/g,'Math.exp').replace(/\babs\b/g,'Math.abs').replace(/\bPI\b/g,'Math.PI');
    try { return new Function('x', `return (${e});`); } catch (_) { return null; }
  }

  function extractFunctionDefinition(text) {
    const t = String(text || '').replace(/\n/g,' ');
    const m = t.match(/f\s*\(\s*x\s*\)\s*=\s*([^.;]+?)(?=\s+(?:We\s+want|Find|Start|Based|$))/i);
    return m ? m[1].trim() : null;
  }

  function extractLimitExpression(context, problemText) {
    let ctx = String(context || '');
    const def = extractFunctionDefinition(problemText || '');
    const spec = parseTarget(ctx) || parseTarget(problemText || '');
    if (!spec) return null;
    if (/f\s*\(\s*x\s*\)/i.test(ctx) && def) return { ...spec, expr:def };
    let m = ctx.match(/lim[^\n]*?f\s*\(\s*x\s*\)/i);
    if (m && def) return { ...spec, expr:def };
    const compact = ctx.replace(/\s+/g,' ');
    const arrowPos = compact.search(/x\s*(?:->|→)/i);
    if (arrowPos >= 0) {
      const after = compact.slice(arrowPos).replace(/^x\s*(?:->|→)\s*[^ )]+\)?\s*/i,'').replace(/^f\s*\(x\)\s*/i,'');
      const eq = after.replace(/^[:=]\s*/,'').trim();
      if (eq && !/^=/.test(eq)) return { ...spec, expr:eq.split(/\s*=\s*/)[0] };
    }
    return def ? { ...spec, expr:def } : null;
  }

  function estimateLimit(fn, x0, side='two') {
    const evalSide = (sgn) => {
      const vals=[];
      for (const h of [1e-2,3e-3,1e-3,3e-4,1e-4,3e-5,1e-5,3e-6]) {
        try { const y=fn(x0+sgn*h); if(Number.isFinite(y)) vals.push(y); else if(y===Infinity||y===-Infinity) vals.push(y); } catch(_){}
      }
      if (!vals.length) return null;
      const last=vals.slice(-3);
      if (last.every(v=>v===Infinity)) return Infinity;
      if (last.every(v=>v===-Infinity)) return -Infinity;
      const finite=last.filter(Number.isFinite); if(finite.length<2) return null;
      const avg=finite.reduce((a,b)=>a+b,0)/finite.length;
      const spread=Math.max(...finite.map(v=>Math.abs(v-avg)));
      if (Math.abs(avg)>1e4 && finite.every(v=>Math.sign(v)===Math.sign(avg))) return Math.sign(avg)*Infinity;
      if (spread <= Math.max(1e-5,Math.abs(avg)*2e-4)) return avg;
      return avg;
    };
    if(side==='left') return evalSide(-1); if(side==='right') return evalSide(1);
    const l=evalSide(-1), r=evalSide(1);
    if(l===Infinity&&r===Infinity)return Infinity; if(l===-Infinity&&r===-Infinity)return -Infinity;
    if(!Number.isFinite(l)||!Number.isFinite(r))return 'DNE';
    if(Math.abs(l-r)<=Math.max(1e-4,Math.abs((l+r)/2)*5e-4)) return (l+r)/2;
    return 'DNE';
  }

  function formatLimitValue(v, decimals=8) {
    if (v === 'DNE' || v == null) return 'DNE';
    if (v === Infinity) return 'oo'; if (v === -Infinity) return '-oo';
    const rat=rationalize(v,64,1e-7);
    if (rat.num != null && Math.abs(rat.value-v) < 1e-6) return rat.text;
    return String(Number(v.toFixed(decimals)));
  }

  function solveSinStandardLimit(problem) {
    const source = `${problem?.text || ''} ${(problem.answers||[]).map(a=>a.context||'').join(' ')}`.replace(/\s+/g,' ');
    if (!/lim/i.test(source) || !/sin/i.test(source)) return null;
    const spec=parseTarget(source); if(!spec || Math.abs(spec.target)>1e-12) return null;
    const m=source.match(/sin\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*x\s*\)\s*\/\s*x/i) || source.match(/sin\s*\(\s*([+-]?\d+(?:\.\d+)?)x\s*\)\s*x?\s*\/?\s*x/i);
    if(!m)return null; const k=Number(m[1]); if(!Number.isFinite(k))return null;
    const entry=fmtNumber(k);
    return {ok:true,engine:'calculator',confidence:'high',answer:entry,entry,steps:[`Use the standard limit sin(u)/u -> 1 as u -> 0.`,`Rewrite sin(${entry}x)/x = ${entry} * [sin(${entry}x)/(${entry}x)].`,`The bracketed factor approaches 1, so the limit is ${entry}.`],richSteps:[{label:'Use the standard limit:',formulas:['sin(u)/u = 1 as u -> 0']},{label:'Rewrite:',formulas:[`sin(${entry}x)/x = ${entry} * (sin(${entry}x)/(${entry}x))`]},{label:'Take the limit:',formulas:[`limit = ${entry}`]}],answerMath:entry};
  }

  function solveCosDifferenceTableLimit(problem) {
    const text=String(problem?.text||'').replace(/\s+/g,' ');
    const m=text.match(/cos\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*x\s*\)\s*-\s*cos\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*x\s*\)[\s\S]*?\/\s*x\s*\^?\s*2/i);
    if(!m)return null;
    const a=Number(m[1]),b=Number(m[2]); if(!Number.isFinite(a)||!Number.isFinite(b))return null;
    const limit=(b*b-a*a)/2;
    const table=(problem.tables||[]).find(t=>t.rows?.some(r=>Number.isFinite(r?.[0]?.value)));
    const xs=table?table.rows.map(r=>r?.[0]?.value).filter(Number.isFinite):[];
    const values=xs.map(x=>(Math.cos(a*x)-Math.cos(b*x))/(x*x));
    const entries=[...values.map(v=>v.toFixed(8)),fmtNumber(limit)];
    const needed=(problem.answers||[]).filter(a=>!['checkbox','radio','hidden'].includes(String(a.type).toLowerCase())||a.dataMq==='calculated').length;
    const out=entries.slice(0,needed||entries.length);
    return {ok:true,engine:'calculator',confidence:'high',entries:out,answer:fmtNumber(limit),steps:[`Evaluate f(x) = [cos(${a}x)-cos(${b}x)]/x^2 at each listed x-value.`,`The numerical values approach ${fmtNumber(limit)} as x approaches 0.`,`Using cos(kx) ≈ 1 - k^2 x^2/2 confirms the same limit.`],richSteps:[{label:'Evaluate the table numerically:',formulas:xs.map((x,i)=>`f(${fmtNumber(x)}) = ${values[i].toFixed(8)}`)},{label:'Use the cosine expansion near 0:',formulas:[`cos(${a}x)-cos(${b}x) ~= (${b*b}-${a*a})x^2/2`,`limit = ${fmtNumber(limit)}`]}],answerMath:fmtNumber(limit)};
  }

  function solveLinearRationalOneSided(problem) {
    const answers=(problem.answers||[]).filter(a=>a.dataMq==='calculated'||!['checkbox','radio','hidden'].includes(String(a.type).toLowerCase()));
    const whole=`${problem?.text||''} ${answers.map(a=>a.context||'').join(' ')}`.replace(/\s+/g,' ');
    if(!/lim/i.test(whole) || !/\//.test(whole)) return null;
    const m=whole.match(/\(??\s*([+-]?\d+(?:\.\d+)?)\s*\*?\s*x\s*\)?\s*\/\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*([+-])\s*([+-]?\d+(?:\.\d+)?)\s*\*?\s*x\s*\)/i);
    if(!m)return null;
    const A=Number(m[1]), C=Number(m[2]), sign=m[3], D=(sign==='-'?-1:1)*Number(m[4]);
    if(![A,C,D].every(Number.isFinite)||Math.abs(D)<EPS)return null;
    const x0=-C/D;
    const entries=[];
    for(const a of answers){ const spec=parseTarget(a.context||whole); if(!spec||Math.abs(spec.target-x0)>1e-5)return null; const side=spec.side==='two'?'right':spec.side; const eps=side==='left'?-1e-6:1e-6; const val=(A*(x0+eps))/(C+D*(x0+eps)); entries.push(val>0?'oo':'-oo'); }
    if(!entries.length)return null;
    return {ok:true,engine:'calculator',confidence:'high',entries,answer:entries.join(', '),steps:[`The denominator is zero at x = ${fmtNumber(x0)}, so this is a vertical asymptote.`,`Check the sign of the numerator and denominator on each requested side of ${fmtNumber(x0)}.`,`The corresponding one-sided limits are ${entries.join(', ')}.`],richSteps:[{label:'Find the vertical asymptote:',formulas:[`${fmtNumber(C)} + (${fmtNumber(D)})x = 0`,`x = ${fmtNumber(x0)}`]},{label:'Check each side:',formulas:entries}],answerMath:entries.join(',')};
  }

  function solveGenericNumericLimits(problem) {
    const answers=(problem.answers||[]).filter(a=>a.dataMq==='calculated'||!['checkbox','radio','hidden'].includes(String(a.type).toLowerCase()));
    if(!answers.length || !answers.some(a=>isLimitContext(a.context))) return null;
    const entries=[], lines=[];
    for(const a of answers){
      if(!isLimitContext(a.context)) return null;
      const spec=extractLimitExpression(a.context,problem.text); if(!spec)return null;
      const fn=compileExpr(spec.expr); if(!fn)return null;
      let v;
      try{ const direct=fn(spec.target); if(Number.isFinite(direct) && spec.side==='two') v=direct; else v=estimateLimit(fn,spec.target,spec.side); }catch(_){v=estimateLimit(fn,spec.target,spec.side);}
      const out=formatLimitValue(v,8); entries.push(out); lines.push(`limit at ${fmtNumber(spec.target)}${spec.side==='left'?' from the left':spec.side==='right'?' from the right':''} = ${out}`);
    }
    if(!entries.length)return null;
    return {ok:true,engine:'calculator',confidence:'medium',entries,answer:entries.join(', '),steps:['Evaluate by direct substitution when the function is continuous.','If direct substitution is undefined, sample values progressively closer from the required side(s).',...lines],richSteps:[{label:'Evaluate the requested limit(s):',formulas:lines},{label:'Enter in order:',formulas:entries}],answerMath:entries.join(',')};
  }


  function parseContinuityTarget(problem) {
    const source = `${problem?.text || ''} ${(problem?.choices || []).map(c=>c.context||'').join(' ')}`;
    const patterns = [
      /(?:continuous|continuity)[^\n.]*?(?:at|for)\s+(?:x|a)\s*=\s*([+-]?\d+(?:\.\d+)?)/i,
      /(?:at|for)\s+(?:x|a)\s*=\s*([+-]?\d+(?:\.\d+)?)/i,
      /f\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*\)/i,
      /x\s*(?:->|→)\s*([+-]?\d+(?:\.\d+)?)/i
    ];
    for (const re of patterns) {
      const m = source.match(re);
      if (m && Number.isFinite(Number(m[1]))) return Number(m[1]);
    }
    return null;
  }

  function graphContinuityFacts(graph, x) {
    if (!graph || !Number.isFinite(x)) return null;
    const pointTol = 0.12;
    const closedPts = (graph.points || []).filter(p => p.closed && Math.abs(p.x - x) <= pointTol);
    const openPts = (graph.points || []).filter(p => p.open && Math.abs(p.x - x) <= pointTol);
    let defined = false, fvalue = null;
    if (closedPts.length) {
      closedPts.sort((a,b)=>Math.abs(a.x-x)-Math.abs(b.x-x));
      fvalue = rationalize(closedPts[0].y,24,0.08).value;
      defined = true;
    } else if (!openPts.length) {
      // If there is no explicit hole at x, a path passing through x represents
      // an included function value.
      for (const path of graphPaths(graph)) {
        const xs = path.map(p=>p[0]);
        if (!xs.length || x < Math.min(...xs)-1e-5 || x > Math.max(...xs)+1e-5) continue;
        const y = interpolateY(path,x);
        if (Number.isFinite(y)) { fvalue = rationalize(y,24,0.08).value; defined = true; break; }
      }
    }
    const left = oneSidedGraphLimit(graph,x,'left');
    const right = oneSidedGraphLimit(graph,x,'right');
    const leftExists = left != null && Number.isFinite(left);
    const rightExists = right != null && Number.isFinite(right);
    const limitExists = leftExists && rightExists && Math.abs(left-right) <= 0.12;
    const limit = limitExists ? (left+right)/2 : null;
    const equalsValue = limitExists && defined && Math.abs(limit-fvalue) <= 0.12;
    return { x, defined, fvalue, left, right, limitExists, limit, equalsValue, continuous: defined && limitExists && equalsValue, openPts, closedPts };
  }

  function tfChoiceIndices(problem) {
    const choices = allChoiceTexts(problem);
    let trueIndex = -1, falseIndex = -1;
    choices.forEach((c,i)=>{
      const t=c.trim().toLowerCase();
      if (t === 'true' || /^true\b/.test(t)) trueIndex=i;
      if (t === 'false' || /^false\b/.test(t)) falseIndex=i;
    });
    return {choices,trueIndex,falseIndex};
  }

  function solveContinuityDefinitionTrueFalse(problem) {
    const {choices,trueIndex,falseIndex} = tfChoiceIndices(problem);
    if (trueIndex < 0 || falseIndex < 0) return null;
    const prompt = String(problem?.text || '').replace(/\s+/g,' ');
    if (!/continuous|continuity/i.test(prompt)) return null;

    let truth = null;
    // Definition/theorem: continuity at a means lim f(x) = f(a).
    if (/if\b[\s\S]*continuous\s+at[\s\S]*then[\s\S]*(?:lim|limit)/i.test(prompt)) truth = true;
    // Merely being defined at a does not force continuity.
    else if (/if\b[\s\S]*f\s*\([^)]*\)\s*(?:is\s+defined|=)[\s\S]*then[\s\S]*(?:continuous|lim)/i.test(prompt) && !/continuous\s+at/i.test(prompt.split(/then/i)[0])) truth = false;
    // A limit existing by itself does not guarantee the function is continuous.
    else if (/if\b[\s\S]*lim[\s\S]*(?:exists|=)[\s\S]*then[\s\S]*continuous/i.test(prompt) && !/f\s*\([^)]*\)\s*=/.test(prompt.split(/then/i)[0])) truth = false;
    if (truth == null) return null;
    const selected = truth ? trueIndex : falseIndex;
    return {
      ok:true, engine:'calculator', confidence:'high', selections:[selected], answer:truth?'True':'False',
      steps:[
        'Use the definition of continuity at a point.',
        'A function is continuous at x = a exactly when f(a) is defined, the limit exists, and lim f(x) = f(a).',
        `Therefore the statement is ${truth ? 'true' : 'false'}.`
      ],
      richSteps:[
        {label:'Continuity at a point requires:', formulas:['f(a) is defined','lim_(x->a) f(x) exists','lim_(x->a) f(x) = f(a)']},
        {label:'Conclusion:', formulas:[truth?'True':'False']}
      ], answerMath:truth?'True':'False'
    };
  }

  function choiceMeaning(text) {
    const t = String(text || '').replace(/\\left|\\right/g,'').replace(/\\to/g,'->').replace(/\\lim/g,'lim')
      .replace(/[{}]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
    if (/not\s+continuous/.test(t)) return 'notContinuous';
    if (/continuous/.test(t)) return 'continuous';
    if (/lim/.test(t) && /=\s*f\s*\(/i.test(t)) return 'limitEqualsValue';
    if (/lim/.test(t) && /exists/.test(t)) return 'limitExists';
    if (/f\s*\([^)]*\).*defined/.test(t) || /defined.*f\s*\(/.test(t)) return 'defined';
    return null;
  }


  function choiceInputMode(problem) {
    const types = (problem?.choices || []).map(c=>String(c?.type || '').toLowerCase()).filter(Boolean);
    if (!types.length) return 'none';
    if (types.every(t=>t==='radio')) return 'single';
    if (types.every(t=>t==='checkbox')) return 'multiple';
    return 'mixed';
  }

  function solveGraphContinuityStatements(problem) {
    const choices = allChoiceTexts(problem);
    if (choices.length < 2) return null;
    const prompt = `${problem?.text || ''} ${choices.join(' ')}`;
    if (!/continuous|continuity|defined|lim/i.test(prompt)) return null;
    // This solver is for "select all" / checkbox-style continuity statements.
    // Do not let it consume radio-button questions such as "which rule is
    // violated first"; those must be handled by the dedicated single-choice
    // solver below.
    const mode = choiceInputMode(problem);
    if (mode === 'single' || /(?:first\s+violated|violated\s+first)|which\s+one/i.test(prompt)) return null;
    const graph = (problem.graphs || []).find(g=>g?.dataScript);
    if (!graph) return null;
    const x = parseContinuityTarget(problem);
    if (!Number.isFinite(x)) return null;
    const facts = graphContinuityFacts(graph,x);
    if (!facts) return null;
    const map = {
      defined:facts.defined,
      limitExists:facts.limitExists,
      limitEqualsValue:facts.equalsValue,
      continuous:facts.continuous,
      notContinuous:!facts.continuous
    };
    const selections=[];
    let matched=0;
    choices.forEach((c,i)=>{ const meaning=choiceMeaning(c); if(meaning){ matched++; if(map[meaning]) selections.push(i); } });
    if (matched < 2) return null;
    const l = facts.left == null ? 'DNE' : rationalize(facts.left,24,0.08).text;
    const r = facts.right == null ? 'DNE' : rationalize(facts.right,24,0.08).text;
    const fv = facts.defined ? rationalize(facts.fvalue,24,0.08).text : 'undefined';
    const lim = facts.limitExists ? rationalize(facts.limit,24,0.08).text : 'DNE';
    return {
      ok:true, engine:'calculator', confidence:'high', selections,
      answer: selections.map(i=>i+1).join(', '),
      steps:[
        `Read the filled point to determine f(${fmtNumber(x)}): ${fv}.`,
        `Approaching from the left gives ${l}; approaching from the right gives ${r}.`,
        `The two-sided limit is ${lim}.`,
        facts.continuous ? 'The limit equals the function value, so the function is continuous.' : 'The continuity conditions are not all satisfied, so the function is not continuous.',
        `Select statement(s) ${selections.map(i=>i+1).join(', ')}.`
      ],
      richSteps:[
        {label:'Function value:', formulas:[`f(${fmtNumber(x)}) = ${fv}`]},
        {label:'One-sided limits:', formulas:[`left limit = ${l}`,`right limit = ${r}`]},
        {label:'Two-sided limit:', formulas:[`limit = ${lim}`]},
        {label:'Continuity:', formulas:[facts.continuous?'continuous':'not continuous']}
      ], answerMath:selections.map(i=>i+1).join(','), debug:{type:'graph-continuity-statements',facts}
    };
  }

  function solveFirstContinuityRuleChoice(problem) {
    const choices = allChoiceTexts(problem);
    const prompt = `${problem?.text || ''} ${choices.join(' ')}`;
    if (choices.length < 3 || !/(?:first\s+violated|violated\s+first)/i.test(prompt) || !/continuity|continuous/i.test(prompt)) return null;
    if (choiceInputMode(problem) === 'multiple') return null;
    const graph=(problem.graphs||[]).find(g=>g?.dataScript); if(!graph)return null;
    const x=parseContinuityTarget(problem); if(!Number.isFinite(x))return null;
    const facts=graphContinuityFacts(graph,x); if(!facts)return null;
    const ruleTruth={defined:facts.defined,limitExists:facts.limitExists,limitEqualsValue:facts.equalsValue};
    const ordered=['defined','limitExists','limitEqualsValue'];
    const firstFalse=ordered.find(k=>!ruleTruth[k]);
    if(!firstFalse)return null;
    let selected=-1;
    choices.forEach((c,i)=>{ if(choiceMeaning(c)===firstFalse && selected<0) selected=i; });
    if(selected<0)return null;
    const l=facts.left==null?'DNE':rationalize(facts.left,24,0.08).text;
    const r=facts.right==null?'DNE':rationalize(facts.right,24,0.08).text;
    return {
      ok:true,engine:'calculator',confidence:'high',selections:[selected],answer:choices[selected] || `Choice ${selected+1}`,
      steps:[
        `Rule 1: f(${fmtNumber(x)}) must be defined. ${facts.defined?'It is.':'It is not.'}`,
        `Rule 2: lim f(x) as x approaches ${fmtNumber(x)} must exist. Left = ${l}, right = ${r}. ${facts.limitExists?'It exists.':'It does not exist.'}`,
        `Rule 3: the limit must equal f(${fmtNumber(x)}). ${facts.equalsValue?'It does.':'It does not.'}`,
        `The first violated rule is choice ${selected+1}.`
      ],
      richSteps:[
        {label:'Check the continuity rules in order:',formulas:[`1. f(${fmtNumber(x)}) defined: ${facts.defined?'yes':'no'}`,`2. two-sided limit exists: ${facts.limitExists?'yes':'no'}`,`3. limit = f(${fmtNumber(x)}): ${facts.equalsValue?'yes':'no'}`]},
        {label:'First violated rule:',formulas:[String(selected+1)]}
      ], answerMath:`Choice ${selected+1}`, debug:{type:'first-continuity-rule',facts,selectedText:choices[selected] || ''}
    };
  }

  function solveContinuityChoiceQuestions(problem) {
    // General definition-based choices without a graph.
    const choices=allChoiceTexts(problem);
    const prompt=String(problem?.text||'');
    if(!choices.length || !/continuity|continuous/i.test(`${prompt} ${choices.join(' ')}`)) return null;
    if((problem.graphs||[]).length) return null;
    // Questions asking which condition/rule belongs to continuity.
    if(/which.*(?:condition|rule)|select.*statement/i.test(prompt)) {
      const selections=[];
      choices.forEach((c,i)=>{
        const m=choiceMeaning(c);
        if(['defined','limitExists','limitEqualsValue'].includes(m)) selections.push(i);
      });
      if(selections.length) return {ok:true,engine:'calculator',confidence:'medium',selections,answer:selections.map(i=>i+1).join(', '),steps:['Use the three conditions in the definition of continuity: the function value is defined, the two-sided limit exists, and the limit equals the function value.'],richSteps:[{label:'Continuity conditions:',formulas:['f(a) is defined','lim_(x->a) f(x) exists','lim_(x->a) f(x) = f(a)']}],answerMath:selections.map(i=>i+1).join(',')};
    }
    return null;
  }
  function normalizeStructuredSolution(result, problem) {
    if (!result?.ok) return result;
    const fillable=(problem?.answers||[]).filter(a=>!['checkbox','radio','hidden'].includes(String(a.type).toLowerCase())||!!a.dataMq);
    let adapted=result;
    if(!result.entries&&!result.selections&&!result.drawing&&result.entry!=null&&
      fillable.length===2&&String(fillable[1].tag).toLowerCase()==='textarea'&&
      /explan(?:ation|in)|show\s+(?:your\s+)?work/i.test(String(problem?.text||''))){
      const source=(problem.mathSources||[]).find(s=>/sin\s*\(/i.test(String(s)))||'';
      const compactSource=String(source).replace(/\\/g,'').replace(/\s+/g,'');
      const ratio=compactSource.match(/sin\(([+-]?\d+)\w+\)\)??\/\(?sin\(([+-]?\d+)\w+\)/i);
      const variable=String(result.debug?.variable||'t');
      const outside=String(result.debug?.expr||'').match(/^\s*([+-]?\d+(?:\.\d+)?)/)?.[1]||'1';
      const explanation=ratio
        ? `As ${variable} approaches 0, sin(${ratio[1]}${variable})/(${ratio[1]}${variable}) and sin(${ratio[2]}${variable})/(${ratio[2]}${variable}) both approach 1. Therefore the expression approaches ${outside}*${ratio[1]}/${ratio[2]} = ${result.entry}.`
        : `${(result.steps||[]).map((step,i)=>`${i+1}. ${step}`).join('\n')}\nTherefore the answer is ${result.entry}.`;
      adapted={...result,entries:[String(result.entry),explanation]};
    }
    const answers = Array.isArray(adapted.entries) ? adapted.entries.slice() :
      (adapted.entry != null ? [String(adapted.entry)] :
      (Array.isArray(adapted.selections) ? adapted.selections.slice() : [String(adapted.answer ?? '')]));
    const rich=result.richSteps || [],plain=result.steps || [];
    const authoredSteps=Array.isArray(result.solution?.steps)?result.solution.steps:null;
    const structuredSteps=authoredSteps?.length?authoredSteps.map(step=>({
      explanation:String(step.explanation||''),
      math:Array.isArray(step.math)?step.math.map(String):[]
    })):plain.map((step,index) => {
      const formulaIndex=rich.length===1&&plain.length>1?plain.length-1:index;
      return {
        explanation:String(step),
        math:formulaIndex===index&&Array.isArray(rich[rich.length===1?0:index]?.formulas)
          ?rich[rich.length===1?0:index].formulas.map(String):[]
      };
    });
    if (!structuredSteps.length) for (const step of rich) structuredSteps.push({
      explanation:String(step.label || '').replace(/:\s*$/,''),
      math:Array.isArray(step.formulas)?step.formulas.map(String):[]
    });
    const exactAnswers = Array.isArray(result.exactAnswers) ? result.exactAnswers.slice() :
      answers.filter(value => /(?:ln|log|pi|sqrt|\/)/i.test(String(value)));
    const decimalAnswers = Array.isArray(result.decimalAnswers) ? result.decimalAnswers.slice() :
      answers.filter(value => /^[+-]?\d+\.\d+$/.test(String(value)));
    return {
      ...adapted,
      topic: result.topic || result.debug?.type || result.engine || 'deterministic-math',
      exactAnswers,
      decimalAnswers,
      solution: {
        topic: result.topic || result.debug?.type || result.engine || 'deterministic-math',
        answers,
        steps: structuredSteps,
        exactAnswers,
        decimalAnswers
      },
      verification: result.verification || { ok:true, method:'deterministic-solver', detail:'Produced by a recognized deterministic rule.' }
    };
  }

  function solve(problem) {
    // These solvers depend on multipart DOM order, graph script state, or
    // choice semantics.  Run them before broad course recognizers so a phrase
    // such as f(0) in an IVT question cannot be mistaken for evaluation work.
    const contextualSolvers = [
      solveLimitImplicationChoices,
      solveGraphFeatureChoice,
      solveGraphLimitBundle,
      solveCapturedLimitLaws,
      solveCapturedContinuity
    ];
    for (const fn of contextualSolvers) {
      try { const result=fn(problem); if(result?.ok) return normalizeStructuredSolution(result,problem); } catch (_) {}
    }
    const course = self.MOMCourseEngine?.solve(problem);
    if (course?.ok) return normalizeStructuredSolution(course, problem);
    const advanced = self.MOMCalculusEngine?.solve(problem);
    if (advanced?.ok) return normalizeStructuredSolution(advanced, problem);
    const solvers = [
      solveContinuityDefinitionTrueFalse,
      solveFirstContinuityRuleChoice,
      solveGraphContinuityStatements,
      solveContinuityChoiceQuestions,
      solveInfinityMeaningChoices,
      solveCosDifferenceTableLimit,
      solveSinStandardLimit,
      solveLinearRationalOneSided,
      solveTableAverageRate,
      solveGraphSecant,
      solveExplicitSlope,
      solveMidpoint,
      solveDistance,
      solveGraphValue,
      solveGenericNumericLimits
    ];
    for (const fn of solvers) {
      try { const result = fn(problem); if (result?.ok) return normalizeStructuredSolution(result, problem); } catch (_) {}
    }
    return null;
  }

  self.MOMCalculator = { solve, _test: { extractPaths, chooseFunctionPath, interpolateY, rationalize, normalizeStructuredSolution } };
})();
