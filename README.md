# DHC-6 CG Calculator

Offline-first PWA prototype for DHC-6 Twin Otter weight & balance / CG
calculations. Manual entry plus a beta manifest scanner (OCR), live CG/%MAC
limit checking, and a printable load-sheet PDF.

> **Safety:** This is a **prototype**. Every aircraft-critical value lives in
> `config.js` and is **not** verified against an operator-approved DHC-6 W&B
> manual. Audit all arms, index/MAC constants, weights and limits against
> current approved aircraft data and SOP before any operational use. The
> config `meta.verified` flag stays `false` until that audit is done.

## Structure

| File | Responsibility |
|------|----------------|
| `index.html` | UI markup + design system (no calculation logic) |
| `config.js` | **Single source of truth** for aircraft data — arms, weights, index/MAC constants, limits, zones |
| `engine.js` | Pure, DOM-free calculation engine (`WBEngine`); unit-testable |
| `app4.js` | UI wiring — reads the form, calls the engine, renders results |
| `scanner.js` | Manifest OCR (Tesseract), load-sheet parsing, PDF/print output |
| `sw.js` | Service worker (offline cache) |
| `tests/engine.test.js` | Engine unit tests |

UI and calculation logic are kept separate: `app4.js` gathers inputs and calls
`WBEngine.computeMetrics(input, DHC6_CONFIG)`; the engine returns weights,
moments, index, %MAC and limit status without touching the DOM.

## Tests

```sh
node tests/engine.test.js
```

## Run / deploy

It's a static site — open `index.html` locally, or enable GitHub Pages on the
`main` branch and load the published URL. No build step.

## Editing aircraft data

Change values only in `config.js` (e.g. DOW/DOI defaults, station arms, CG
limits, MAC conversion). After editing, run the tests and re-verify against the
approved manual.
