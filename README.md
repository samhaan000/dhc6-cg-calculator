# DHC-6 CG Calculator

Offline-first PWA for DHC-6 Twin Otter weight and balance. A professional,
mobile-first workflow: aircraft setup → private on-device manifest scan →
passenger and seat review → cargo and fuel → CG results and review sheet.

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
| `seating.js` | Pure passenger-seat optimizer (`WBSeating`) |
| `app.js` | Wizard controller — state, steps, OCR run, CG-envelope chart, PDF |
| `index.html` | App shell + design system |
| `sw.js` | Service worker (offline cache) |
| `vendor/tesseract/` | Pinned local OCR engine, worker, English data and WebAssembly core |
| `tests/*.test.js` | Engine + wizard-integration unit tests |

`app.js` collects the loading (aircraft, passengers with seat assignments,
cargo, fuel) and calls `WBEngine.computeMetrics(input, DHC6_CONFIG)`. OCR text
is parsed by `WBParsers`; nothing is silently accepted. Structured resort
manifests are rebuilt from OCR word positions so the app can read passenger
names, ticket rows, passenger weights and luggage totals. Detected category and
load totals are editable before import, so a faint gender column never blocks
the workflow. Passenger names are optional. Infants are attached to an occupied
adult seat as lap passengers: their weight is included at that seat arm without
using another cabin seat. The seating optimizer creates a balanced initial
cabin and can be run again after fuel and baggage are entered. Pilots can leave
the preferred takeoff index on Auto, choose a quick target, or enter a custom
target; the optimizer reports the closest achieved value while prioritizing the
configured takeoff/landing CG and index safety zones;
the completed load is still checked against every configured CG and weight limit.
Category totals are cross-checked against the printed passenger-weight total;
unclear passengers are flagged and counts above the 15-seat capacity are blocked.

OCR assets are self-hosted and included in the service-worker cache. Passenger
manifest images never leave the device. Raw OCR text is not persisted, and the
active flight is kept only in session storage; saved aircraft presets remain in
local storage.

Invalid inputs such as negative baggage, negative trip fuel, trip fuel above
takeoff fuel, duplicate seats, overweight loads and out-of-envelope CG block
printing. While `config.meta.verified` is `false`, any printable output is
permanently marked **UNVERIFIED / NOT FOR OPERATIONAL USE**.

## Tests

```sh
npm install   # dev only: jsdom, for the headless smoke test
npm test      # engine + wizard unit tests + headless wizard smoke test
```

`tests/smoke.test.js` loads the real page in jsdom and drives the whole wizard.
The suite also checks negative/impossible loads, OCR parser regressions,
editable scan results, automatic seat balancing, the New Flight reset, and the
locally cached OCR deployment assets.

## Run / deploy

Static site, no build. Serve the repository root through GitHub Pages on `main`.
Use a local HTTP server for development because service workers and OCR workers
do not run correctly from a `file://` URL.

## Editing aircraft data

Change values only in `config.js`, then re-run the tests and re-verify against
the approved manual.
