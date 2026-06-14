# DHC-6 CG Calculator

Offline-first PWA for DHC-6 Twin Otter weight & balance. A mobile-first
**wizard**: Dashboard → Scan manifest (OCR) → Review & correct passengers →
Cargo & fuel → Results (CG/%MAC, limit status, CG-envelope graph) → export /
print load sheet.

> **Safety:** Prototype. Every aircraft-critical value lives in `config.js` and
> is **not** verified against an operator-approved DHC-6 W&B manual. Audit all
> arms, index/MAC constants, weights and limits against current approved data
> and SOP before any operational use. `config.meta.verified` stays `false`
> until then.

## Architecture (UI and calculation are separate)

| File | Responsibility |
|------|----------------|
| `config.js` | **Single source of truth** for aircraft data — arms, weights, index/MAC constants, limits, float zones |
| `engine.js` | Pure, DOM-free calculation engine (`WBEngine`) |
| `parsers.js` | Pure manifest OCR text parsers (`WBParsers`) |
| `app.js` | Wizard controller — state, steps, OCR run, CG-envelope chart, PDF |
| `index.html` | App shell + design system |
| `sw.js` | Service worker (offline cache) |
| `tests/*.test.js` | Engine + wizard-integration unit tests |

`app.js` collects the loading (aircraft, passengers with seat assignments,
cargo, fuel) and calls `WBEngine.computeMetrics(input, DHC6_CONFIG)`. OCR text
is parsed by `WBParsers`; nothing is silently accepted — unclear passengers are
flagged "needs review" and export is blocked until resolved.

## Tests

```sh
npm install   # dev only: jsdom, for the headless smoke test
npm test      # engine + wizard unit tests + headless wizard smoke test
```

`tests/smoke.test.js` loads the real page in jsdom and drives the whole wizard
(it skips automatically if jsdom isn't installed). The engine/wizard unit tests
need no dependencies.

## Run / deploy

Static site, no build. Open `index.html`, or serve via GitHub Pages on `main`.

## Editing aircraft data

Change values only in `config.js`, then re-run the tests and re-verify against
the approved manual.
