# MOM Helper

MOM Helper is a Chrome extension for supported MyOpenMath **Calculus I** questions. It uses deterministic math rules to show step-by-step work and can fill supported answer fields. It never submits a question. Optional AI fallback is off by default.

**Physics and Calculus II are not supported yet; they are planned for later releases.**

[Project page](https://bmreyes25.github.io/mom-helper/) · [Latest download](https://github.com/bmreyes25/mom-helper/releases/latest) · [Release notes](RELEASE_NOTES.md)

## Install

1. Download the latest release ZIP and extract it.
2. Open `chrome://extensions` and enable Developer mode.
3. Select **Load unpacked** and choose the extracted extension folder.
4. Open a supported MyOpenMath Calculus I problem and click the MOM Helper icon.

The `extension/` directory contains the loadable source. The `docs/` directory contains the GitHub Pages site.

## Current scope

The release is focused on Chapter 1 (functions, trigonometry, inverses, exponentials, and logarithms) and Sections 2.1–2.4 (rates of change and introductory limits) in the captured course. Support varies by problem format. A result should be checked before submission.

The local development test suite passes 35 representative syllabus tests and 64 focused tests. It solves 215 usable captured question states without AI. Four historical captures were incomplete and excluded. These offline results are not a promise that every future question or live MyOpenMath widget works.

No real homework submissions are automated.
