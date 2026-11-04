# Progress & TODO — neuroscape-synergy-demo

This file is the running log. `SCOPE.md` holds direction; this file holds state.
Keep every entry dated. New work goes on top. Move items to "Done" with the date
and a one-line note on how it was verified.

## Now

- [ ] **Searchable Mainframe picker** — replace the `<select>` with a text-filtered combobox; keyboard navigable, aria-compliant. *(owner request)*
- [ ] **RAM control rename** — "Installed RAM strategy" → "Simulated RAM budget" with the one-sentence explainer (SCOPE §7). *(pending owner approval of wording)*
- [ ] **Awaiting live test: link import v3** — owner to re-test the azuniverse link with the 4-source race; send the "Tried: …" diagnostics if it fails. CORS-header ask to the azuniverse developer still pending.
- [ ] **Performance pass** — measure first, then: audit simulator hot-loop allocations, `requestAnimationFrame`-batched progress, defer offscreen chart builds, re-time `scrollIntoView` behavior. Worker only if measurement justifies it.
- [ ] **Effect-aware simulation layer (deferred, later goal)** *(owner 2026-11-03)* — model cards that draw/see extra cards, cards that install RAM, and tutor effects. Extends the structural simulator toward true deck behavior; largest engine change on the books. Design before code: effect schema in catalog, policy hooks in `simulate()`, and a validation story (catalog validator extended to effect fields). ❓ needs a design pass when prioritized.
- [ ] **Watch relay health** — azuniverse link imports fall back to public CORS relays (allorigins / cors.lol / cors.sh). The azuniverse API itself sends no CORS header, so if the live site fails to import, check relay availability first; a tiny Cloudflare Worker relay is the sturdy long-term fix.

## Backlog (unprioritized)

- [ ] **Export options** *(owner 2026-11-03, replaces URL sharing — declined)* — export results as PNG (charts + stats card) and/or one-click copyable stats summary (markdown/text for Discord/forums). SVG→canvas→PNG pipeline fits the no-dependency rule.
- [ ] Mulligan modeling toggle (simulator currently uses a fixed heuristic keep).
- [ ] Conditional view: P(tier online by turn t | opening hand kept).
- [ ] Side-by-side deck comparison with overlaid curves.
- [ ] Catalog import/merge helper for new prints (beyond the validator).
- [ ] "How to read the curves" worked example + glossary.
- [ ] More example decks (owner to supply lists).
- [ ] Accessibility check of 12px chart text against AA.

## Done

- 2026-11-03 — **Both tables condensed to shorthand rows** *(owner: clunky, wants one line per tier)* — milestone table: 3 columns (Tier / Reached by turn N / Typical turn), each cell packs 1st · 2nd on one line; draw table: 2 columns (Tier / After N cards seen) with icons · full on one line, picker input (5–20). `table()` now accepts `{html}` cells for bold tier keys, hint sublabels, and Wilson-interval tooltips; legend gains **T1 / 1st / 2nd** shorthand with tier definitions. Fixed a doubled-brace syntax error from the edit; id crosscheck (29 ids) + engine output spot-checks + render test all pass. Script tag `?v=20261103-5`.
- 2026-11-03 — **Milestone table rebuilt** *(owner: fixed turn columns hard to parse)* — replaced the 3/5/8/12/20 grid with: a **turn picker** (numeric input, updates on type) showing "Reached by turn N" % + Wilson interval, and a **Typical (median) turn** column — the median first-hit turn per tier/position (lower-median convention), 'not reached' when absent. Logic verified against 4 synthetic cases (incl. gaps in rows, never-reached) and real engine output; even-split median convention checked. Script tag bumped `?v=20261103-4`.
- 2026-11-03 — **Honest progress phases** *(owner spotted counter reaching >5,000 while curves say n=5,000)* — progress now reports per stage: "Testing RAM budgets · 192 pilot games" (auto target only), then "Simulating turn curves · n / 5,000 games · going first/second". Engine emits stage-scoped counts; UI adds position to the label. Node-verified event sequence: pilot 24→192, main 25→5,000 per position, curves still n=5,000. Script tags bumped to `?v=20261103-3`.
- 2026-11-03 — **Cache-mismatch guard** *(owner hit `$(...) is null`)* — cause: browser mixed old cached `app.js` (referencing removed `#trials`) with fresh `index.html`. Fix: versioned query strings on all three script tags (`?v=20261103-2`); bump the suffix whenever shipped JS changes. Verified: id-crosscheck script proves all 27 `$('…')` references exist in current HTML, no stale refs; render test clean.
- 2026-11-03 — **Fixed trials, Max turns input, stepper removed** *(owner decisions)* — trials selector deleted; 5,000 always, n shown in subtitle + curve hint (5,000-trial 12-turn run ≈ 3s, 40-turn verified); "Own turns" select replaced by numeric **Max turns** (1–40, default 12, engine-validated, milestone fallback when max < 3); workflow stepper removed from markup + CSS. Render test clean. SCOPE §4/§6/§8 updated.
- 2026-11-03 — **Import racer v3: r.jina.ai source + diagnostics** *(owner still saw total failure)* — added `r.jina.ai` as second source (**browser-verified CORS: echoes any origin**, ~700ms, raw JSON in markdown wrapper); `engine.jsonFromLooseText` strips relay wrappers; timeout raised 10→15s; failures now list per-source results (e.g. "azuniverse.net: blocked; r.jina.ai: HTTP 500; …") so live failures are diagnosable. AllOrigins flaky (500/522 during testing); cors.lol rate-limited. Node race sim: direct API won at 235ms.
- 2026-11-03 — **Parallel import race** *(owner reported slow imports)* — link sources now race in parallel via `Promise.any` (10s AbortController timeout each) instead of sequential tries; winner typically the direct azuniverse API at ~250ms in Node simulation. AllOrigins verified live-working (200 + CORS + valid JSON); cors.lol rate-limited, cors.sh flaky. Owner will ask the azuniverse developer for a one-line CORS header — recorded as the preferred fix in SCOPE §5.
- 2026-11-03 — **azuniverse.net link import** — root cause of "link not working": no CORS header + SPA HTML (deck data only in `api/decks/{id}` JSON). Built `engine.decklistFromAzuniverse` (URL regex + JSON→decklist; verified against the owner's real deck: 50 cards, BERSERKER mainframe, 0 parse errors) and a fetch chain: direct API → 3 public CORS relays. Local relays test failed (network blocks them) so browser behavior needs a live-site check.
- 2026-11-03 — **Link import added** *(owner request)* — one import block: file picker + URL field with Import button (Enter works too). Fetches in-browser, validates http(s), guards against HTML/image payloads, fills the decklist field, shows a plain-language CORS fallback message. Engine re-verified in Node; app.js syntax-checked; page render-verified.
- 2026-11-03 — **Spectrum bar removed** *(owner request)* — six-color gradient strip deleted from header; docs/SCOPE design-token notes updated to match. Header/empty-state mark resized square to suit the new favicon-shaped mark.
- 2026-11-03 — **Favicon I wired in** — owner picked "solid contact strip" variant; `assets/favicon.svg` + generated `favicon-32.png` / `apple-touch-icon.png` (headless Chrome); `<link rel="icon">` tags added; header and empty-state now use the new mark; `logo-circuit-ram.svg` no longer referenced. Verified: automated checks + full-page screenshot.
- 2026-11-03 — **Favicon round 1 declined** — owner rejected A–D; new direction: **simple diagonal RAM stick with a heartbeat trace through it**. Built four variants (E along-stick, F horizontal-crossing, G bare no-tile, H DIMM pins) in `design/favicon-candidates-2.html`, opened in Chrome for owner review.
- 2026-11-03 — **Workflow preference** — always open links/previews in Google Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe`), not Edge or explorer handoff.
- 2026-11-03 — **Favicon candidates built** — four simpler-mark SVGs (A chip+pins, B RAM cell, C teal corner, D curve pulse) in `design/`, headless-Chrome render-verified; comparison page `design/favicon-candidates.html` awaiting owner pick. Recommendation: B.
- 2026-11-03 — **SCOPE.md updated to v0.2** — recorded owner decisions: player audience (new + old), static hand-maintained catalog with validator idea, locked styling except RAM mark, renamed control proposal ("Simulated RAM budget"), voice principles, new near-term priority list.
- 2026-11-03 — **Owner direction captured** — searchable Mainframe picker, Max turns numeric input, trials kept as-is, layout review, performance optimization, simpler RAM mark/favicon added to plan.
- 2026-11-03 — **SCOPE.md drafted** (v0.1): purpose, audience, non-goals, shipped/candidate features, architecture constraints, design tokens, voice, and owner questions. Synthesized from README, UI copy, and code review.
- 2026-11-03 — **Repo cloned, codebase verified** — engine runs headless in Node; example deck analyzes in ~800ms at 250 trials with no parse errors; curves, draw tables, and force-quit stats all emit valid values.
