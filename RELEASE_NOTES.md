# Release notes

## v1.6.6 — Piecewise values and Calc I release

- Recognizes piecewise functions encoded as MyOpenMath/MathJax arrays even when they omit the word “if.”
- Chooses the correct branch for each requested input and maps all values to their corresponding answer fields. The newest missed capture now yields `f(-1)=-5`, `f(0)=8`, and `f(2)=26`.
- Adds the latest 14-question capture to regression testing. All 215 usable stored captured states solve locally and deterministically; four incomplete historical captures remain excluded.
- Launches the project page and clarifies the current scope: **Calculus I only**. Physics and Calculus II are planned, not available.

The extension never auto-submits. AI fallback remains optional and disabled by default. Live grading and future question formats are not guaranteed by offline tests.

## v1.6.5 — Inline mathematical work

- Typesets mathematical expressions within smaller explanatory sentences in MathML.
- Reworks a quadratic-substitution True/False case into five ordered teaching steps before the verdict.
- Preserves explanation prose exactly in the captured-state rendering audit.

## v1.6.4 — Logarithm multipart fixes

- Solves a domain question with both a radio inequality and numeric boundary.
- Solves three-coefficient `log` and `ln` expansion questions.
- Gives rational inverse problems a full algebraic derivation and fixes premature final-answer placement in step cards.

## v1.6.3 — First-try consistency

- Corrects and independently verifies emitted rational inverse answers.
- Refreshes the live question before solving and refuses autofill if its text or answer fields change.

Older development history is documented in the extension's internal README and test report.
