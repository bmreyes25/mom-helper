# MOM Helper v1.6.6 Test and Audit Report

Generated from `npm test` against every stored corpus through the latest fourteen-question September 23 capture.

## Results

- Legacy representative syllabus tests: 35/35
- Focused parser/solver/adapter/graph/corpus tests: 64/64
- Latest September 23 capture records solved: 14/14
- Third September 23 follow-up records solved: 3/3
- Second September 23 follow-up records solved: 2/2
- September 23 follow-up corpus records deterministically solved: 8/8
- September 23 corpus records deterministically solved: 31/31
- Corpus (9) records deterministically solved: 6/6
- All stored captures audited: 219
- Usable captured states solved deterministically: 215/215
- Incomplete historical captures excluded: 4
- Solved states with structured teaching steps: 215/215
- Solved states with successful verification metadata: 215/215
- Multipart answer-count mismatches: 0
- JavaScript syntax checks: passed for all runtime files
- Consecutive-solve stability: 215/215 usable captures returned identical results
- Submit-button audit: no submit action exists in the extension runtime

## v1.6.6 piecewise regression

- A MathJax piecewise array without explicit “if” was not recognized. The parser now accepts both forms and normalizes `geq`/`leq` conditions.
- The captured three-field question maps `f(-1)=-5`, `f(0)=8`, and `f(2)=26` in displayed order, with one substitution step per field.
- Physics and Calculus II are not in the supported scope. These results are offline captured-state checks, not a live MyOpenMath grading guarantee.

## v1.6.5 inline work audit

- A captured-state UI-rendering test preserves the exact text of all 682 solution explanations while typesetting 628 embedded expressions in inline MathML.
- The pictured quadratic substitution True/False problem now has five ordered teaching steps and no premature answer card.
- Inline math uses a conservative recognizer; any unsupported expression remains readable prose. A live visual check in the Chrome popup is still needed.

## v1.6.4 fixes and limits

- The new domain question returns both the strict `x > A` radio choice and `A=-3`; mixed-choice autofill no longer exits before writing the numeric part.
- Logarithm coefficient extraction now recognizes `log` as well as `ln` on the right-hand side. Captured coefficient triples are `[15,10,-9]` and `[12,1/2,-1]`.
- Rational inverse problems have seven explicit MathML-compatible algebra steps. A corpus-wide regression test checks the 97 captured cases with a single summary formula and multiple prose steps: none display that summary under step 1.
- A MathML audit rendered 663 step formulas from the stored captures; 35 are prose-like annotations or unsupported limit phrasing and now display as ordinary prose rather than fake mathematical notation.
- Live MyOpenMath grading and the mixed radio-plus-MathQuill fill path still need an end-to-end browser check. The tests verify solver output and stored question structure, not the site's live re-render behavior.

## v1.6.3 root causes and fixes

- The rational-inverse formatter used the denominator constant's sign backwards. Worse, its old check verified a separately calculated value rather than parsing the answer string it returned. The formatter is corrected, and the emitted string itself is now composed with the original function at multiple inputs.
- The popup previously solved the question snapshot captured when it opened. MyOpenMath can replace the problem after “similar question,” grading, or rerendering while keeping the popup open, so the first click could solve stale data and the second click could solve fresh data. Solve now reads the live page immediately before calculation.
- Some assignment layouts have an anonymous outer wrapper and an ID only on the inner question region. The old inferred ID came from the answer number and did not necessarily exist in the DOM. Question identity now uses the real inner ID and can locate a wrapper from its answer fields.
- Autofill now refuses to write if question text or answer IDs changed between calculation and fill.

These are offline captured-state tests, not a live MyOpenMath autofill or grading check. The supplied corpus includes 31 of the 36 questions shown in the full assignment; five remain uncaptured and therefore unverified.

## v1.6.2 fill and presentation fixes

- IMathAS's MathQuill editor reacts to a hidden-field `change` by interpreting that field as LaTeX. The extension wrote grader syntax and then dispatched `change`, causing an immediate overwrite. It now writes the visible MathQuill formula, sets the grader value, and sends only `input`. Bridge-level tests simulate IMathAS's change feedback for two-field and four-field questions.
- The popup displays one MathML answer per field. Top-level comma-separated lists now parse as MathML, including the three-angle trig answer.
- A separate written-explanation field receives explanation text based on the solution steps; a previously mismatched IVT root-count capture now returns its single numeric answer.
- Every usable historical capture now has a field-count assertion in addition to solution/step checks.
- Every captured MathQuill answer is tested through the LaTeX serializer, and the fill adapter rechecks all written fields after a short stabilization delay.

## v1.6.1 regression fixes

- The two-part polynomial prompt formerly filled only `f(x+h)`; it now computes and maps the second difference-quotient or subtraction answer separately.
- The trig problem `2cos²(w)-3cos(w)+1=0` now returns `0,pi/3,5*pi/3` in one list field, while the earlier two-field `2cos(x)-1=0` remains separate.
- A broad function-classification handler intercepted graph-choice questions, while an evaluation handler intercepted an IVT choice. Both now require the right prompt context.
- Graph line tests use plotted curve data ahead of axes and grid lines; captured one-to-one choice questions now map to the correct radio choice.
- Rational inverse, logarithm coefficient, condensation, and scaled-log equation cases from the new corpus have regression tests.
- Multipart autofill validates the exact field count, preflights fields, and refuses to report success on a partial fill.

## Root causes fixed

1. Every multipart graph field inherited the full prompt as its context, so the old adapter repeatedly answered the first graph task. Tasks are now extracted and mapped in displayed order.
2. Rendered SVG point extraction was incomplete. Open and closed points are now read from MyOpenMath's graph script data.
3. One-sided graph selection could choose a segment ending on the wrong side of the target. Candidate paths now must extend into the requested side.
4. Limit-implication parsing confused the negative result `-3` with a left-side marker. Side markers are now parsed only inside the limit target.
5. Broad function-evaluation recognition intercepted an Intermediate Value Theorem choice question. Contextual choice solvers now run first.
6. Continuity parameter, jump, multi-boundary, and mixed answer-type questions lacked deterministic handlers.
7. The popup did not explicitly label its work area, and course-engine results were mislabeled as AI fallback. The UI now shows a numbered **Solution steps** section and accurate engine labels.
8. Autofill now refuses any deterministic result that lacks structured teaching steps.

## Captured cases added

- graph values, one-sided limits, two-sided limits, and filled-point values
- graph selection from stated value and one-sided-limit conditions
- logical implication checkbox sets
- four-part limit-law arithmetic
- Intermediate Value Theorem selection
- linear and nonlinear continuity parameters
- jump discontinuity limits
- three-piece continuity system
- mixed calculated/select/list discontinuity question

For `4^x = 53`, the verified decimal value remains `2.8640` to four decimal places. The extension never presses **Submit Question**.

## v1.5.1 follow-up fixes

- Corrected the piecewise parameter bundle: the right-hand limit field receives `5*c`; the required two-sided-limit field receives `-13`.
- Candidate-graph matching now ignores explanation SVGs that MyOpenMath appends after an answer.
- Pre-render ASCIIsvg `<embed>` elements are read through their graph `script` attribute instead of being treated as missing graphs.
- All 27 complete states in corpus (5) solve with teaching work and matching multipart field counts. One old serialized capture lacks extracted graph data and is safely not guessed; the runtime `<embed>` fix prevents that omission in new captures.

## v1.5.2 MathQuill serialization fix

- Replaced simulated character-by-character MathQuill typing with structural LaTeX insertion. Simulated typing left the cursor inside an exponent, turning `x*y^3/z^4` into `x*y^(3/(z^4))`.
- The screenshot case now renders as the fraction `(x*y^3)/(z^4)` while the hidden MyOpenMath grading value remains `x*y^3/z^4`.
- Added serializer coverage for nested products, powers, exact logarithmic answers, lists, interval notation, infinity, square roots, and equations.
- Added all three corpus (6) records as regression fixtures.
- MathQuill fills now read the hidden value back after MyOpenMath events and fail instead of reporting success if the requested serialization was not retained.

## v1.5.3 deterministic self-sufficiency audit

- Fixed the final corpus (8) checkbox question. The course treats both “increases without bound” and “becomes infinite” as descriptions of a positive infinite limit; both are now selected regardless of randomized choice order.
- The solver continues to reject the unrelated statements that `x` goes to infinity, that `f(a)=infinity`, or that infinity is an ordinary finite limit value.
- Audited every stored corpus in calculator-only mode: 155 captures total, 151 usable states solved deterministically with structured steps and verification, and zero usable states requiring AI or an external service.
- The four excluded snapshots are two `Loading...` records and two old graph snapshots serialized without graph state. Current `<embed>` and SVG graph extraction prevents those incomplete runtime states.

## v1.6.0 multi-question and corpus (9) fixes

- Full assignment pages now return a `questions` collection plus the active question. The popup shows an explicit problem selector when more than one is present.
- Autofill and manual capture include the selected wrapper ID, preventing answers from being written into a neighboring question.
- The captured domain/range graph now reads the red `path(...)` data and fills `-3`, `0`, `-5`, `-1` into its four scalar blanks.
- The captured function prompt fills both the expanded `f(x+h)` expression and its difference quotient.
- Added deterministic solutions for `2cos(x)-1=0`, the compound 45-degree exact-value expression, and the piecewise line/dot drawing widget.
- Audit result is now 161 stored captures, 157 usable states solved locally, four incomplete historical snapshots, and zero usable states requiring AI.
