# Neuroscape synergy demo — Scope & direction

Owner: Kanin · Repo: `KaninB/neuroscape-synergy-demo` · Live: https://kaninb.github.io/neuroscape-synergy-demo/
Status: v0.2 (2026-11-03). v0.1 synthesized scope from README/UI/code; v0.2 records owner decisions on audience, catalog lifecycle, styling, and next UI changes. Remaining unknowns are marked ❓.

---

## 1. Purpose

**One sentence:** help an AZ Universe player see *when* a deck's Mainframe synergy comes online — before playing it.

The tool answers two complementary questions for any legal Cyberdeck (50–255 cards):

1. **Exact draw odds** — "After *h* random cards seen, what is the probability I hold the printed faction sources (and board count) for tier *t*?" Computed with without-replacement combinatorics. This is math, not simulation.
2. **Estimated turn curves** — "By my own turn *t*, what is the probability tier *t* has been reached?" Computed with a structural Monte Carlo simulator that models RAM installs, costs, faction gates, gear hosting on ports, persistent slots, and heuristic character force quits.

The tool is deliberately honest about its boundaries: printed card effects, tokens, combat, and lethal endings are **not** modeled. Turn curves are estimates, and every results view says so.

**Stated principles** (from README and UI copy — treat as fixed unless changed here):
- Unofficial; no affiliation implied with the AZ Universe game.
- Browser-only. No server, no accounts, no uploads. Decklists never leave the visitor's machine. Downloading a JSON result is the only data export.
- Fully static hosting (`index.html`, `app.js`, `engine.js`, `catalog.js`, `assets/`).

## 2. Audience & jobs-to-be-done

**Confirmed (2026-11-03):** the primary user is AZ Universe players — both new and experienced. The tool must be approachable enough to learn from (plain-language explanations, examples) and precise enough to reward experienced deckbuilders (exact math, tight controls).

Jobs the tool should serve:
- Compare candidate lists: "does swapping 4 cards move Tier 2 a turn earlier?"
- Sanity-check faction/source density before playtesting.
- Choose a RAM strategy (the tool's auto-RAM pilot exists for exactly this).
- Set expectations: "Tier 3 by turn 8 in ~60% of games going second."

## 3. Non-goals

Current scope lines — do not build these without revisiting this document:
- A full game engine. Printed abilities, tokens, attacks, opponent interaction, and lethal endings stay out of the simulator.
- Server-side anything: storage, sharing service, user accounts, telemetry.
- A deck *editor/builder* UI. Input is import/parse of existing lists only.
- Opponent modeling or matchup analysis.
- Collection management, prices, legality checks beyond deck size and copy limits.

## 4. Feature scope

**Shipped (v0, commit 937ad81):**
- Decklist upload (.txt/.csv/.md) or paste; flexible line formats; section headers (`#CYBERDECK`, `#RAM`, `#SIDEBOARD`, `#MAINFRAME`); copy-limit and legality validation with line-numbered errors.
- Mainframe picker (20 in catalog) with auto-detect from exports.
- Decklist import from file (.txt/.csv/.md) **or link** (added 2026-11-03): one import block, both paths. Links to `azuniverse.net/decks/{id}` are auto-converted to the site's JSON API and transformed into a decklist (Mainframe line + `#CYBERDECK` section; sideboard preserved; RAM section skipped). azuniverse.net sends no CORS header, so azuniverse imports try the direct API then public CORS relays; plain-text links (CORS-enabled hosts) fetch directly.
- Exact draw curves per tier: faction-only vs. full printed threshold (faction + board count), cards seen 5–20.
- Simulated turn curves per tier, going first/second, turns 1–12 or 1–20, trials 250–5,000, Wilson 95% intervals.
- Auto RAM-target selection via pilot runs (or manual stop-at-N RAM).
- Source summary per tier (counts, density, RAM-cost and type breakdowns).
- Milestone + draw tables, deck composition summary, JSON result download, 50-card example deck.

**Candidate near-term (❓ prioritize):**
- Shareable URL: encode decklist + settings in `location.hash`, restore on load (keeps privacy stance — nothing sent anywhere).
- Favicon + brand mark in more slots (see §6).
- Automated engine smoke tests in Node + CI on push (engine already exports a Node-compatible API).
- More example decks (❓ one per archetype? supplied by whom?).
- "How to read these curves" explainer (worked example interpreting a curve + intervals).

**Backlog ideas (uncommitted):**
- Mulligan modeling toggle in the simulator (currently the opening hand uses a fixed heuristic keep).
- Conditional opening-hand view: "P(tier 1 online by turn 3 | kept this hand)."
- Side-by-side deck comparison (two lists, overlaid curves).
- Performance budget review for 5,000-trial × 20-turn runs (simulator already yields to the event loop via `setTimeout`; a Web Worker is the fallback if UI jank shows up).
- Light theme or theme toggle ❓.
- Catalog refresh pipeline ❓ (see §8).

## 5. Architecture constraints

These are load-bearing decisions; changes require updating this doc:
- **No build step, no dependencies, no framework.** The page must keep working as plain static files on GitHub Pages. Vanilla JS and hand-rolled SVG charts only.
- **`engine.js` stays headless-runnable.** It must remain importable in Node (`module.exports` already provided) so logic can be tested without a browser.
- **`catalog.js` is a data blob**, sha256-stamped (`catalog_sha256`), currently 257 cards across CHARACTER/PROGRAM/GEAR/MAINFRAME/RAM types. Results embed the hash for reproducibility. **Lifecycle (confirmed 2026-11-03): static and hand-maintained** — the owner updates it manually when cards print. A dev-time Node validator script should check catalog integrity (unique ids, known types, tier sanity, copy-limit fields) to catch hand-edit typos before they ship.
- **Link imports are best-effort client-side.** azuniverse.net sends no CORS header, so azuniverse deck links race the direct API against public CORS relays (allorigins / cors.lol / cors.sh), 10s timeout each, fastest healthy source wins. **Preferred permanent fix: the azuniverse developer adds `Access-Control-Allow-Origin: https://kaninb.github.io` (or `*`) to `/api/decks/*` responses** — then imports are instant, direct, and relay-free. Owner will raise this with the developer (2026-11-03).
- **Determinism where it matters:** simulator seeds derive from an FNV-1a hash of the deck signature + mainframe, so identical inputs replay identically.
- **Privacy is a feature,** not an accident: keep all computation client-side; keep copy in the UI that says so.
- **Limit disclosures are mandatory content:** any view showing simulated numbers must surface the structural-model warning.

## 6. Styling & design system

**Confirmed (2026-11-03):** the overall look is set in stone for now. The one open visual item is the RAM symbol: the owner wants a **simpler mark** than the current `logo-circuit-ram.svg`, usable both as the browser-tab favicon and as the site mark. `assets/logo-ram-core.svg` (compact chip with pins) is the closest existing candidate; a fresh minimal mark may be designed from it. All other styling below is a fixed reference, not a proposal.

### Tokens
| Token | Value | Use |
|---|---|---|
| `--page` | `#171A1D` | page background (+ faint 72px grid lines overlay) |
| `--panel` | `#262B2F` | panels/cards |
| `--raised` | `#353B40` | inputs, wells, chips |
| `--text` / `--muted` | `#F9FAFB` / `#BCC4D0` | copy / secondary copy |
| `--line` | `#4B565E` | borders, chart gridlines |
| `--action` / `--action-ink` | `#24C8A5` / `#06261F` | primary buttons, accents, focus rings |
| `--danger` / `--warning` | `#F0785A` / `#F4B942` | errors / caution notes |
| Series 1–6 | `#24C8A5`, `#E25C8D`, `#F4B942`, `#8B7CF6`, `#56B4E9`, `#F0785A` | tier colors on all charts |

### Typography
- Body: Verdana 15px/1.52 (system font stack — zero font loading, part of the performance posture).
- Headings: Arial bold, tight letter-spacing; `h1` scales `clamp(31px, 3.25vw, 49px)`.
- Numerals/code/decklists/tables: `"Courier New", ui-monospace`.
- Micro-labels: 10–11px uppercase, letterspaced Arial.

### Signature elements
- **Panels:** 4px radius, 1px `--line` border, heavy soft shadow.
- **Workflow stepper:** boxed 1-Upload / 2-Review / 3-Calculate strip.
- **Charts:** hand-rolled SVG step-lines (solid/long-dash/dotted pairing with series colors), 4px dots, Wilson bands rendered as tables not shading (keep charts uncluttered).
- **Info popovers:** circular `i` buttons with hover/focus/click popovers, Escape- and outside-click-dismissed, `aria-expanded` maintained.
- **Countbox / stat tiles / pills / amber-bordered notes** as recurring content atoms.

### Layout & responsive behavior
- Max width 1420px; two columns (sticky input 330–420px, fluid results); collapses to single column ≤1020px; mobile tightening ≤650px (workflow steps shrink, stat grid 2-up). ❓ Confirm mobile is a first-class case (phone use between rounds?) — current CSS suggests yes.

### Motion
Restrained: progress-bar width transition and popover fades only. No entrance animations, no parallax.

### Accessibility
- `aria-label`s on all inputs and regions, `aria-live` on status/count, `aria-expanded` on popovers, visible 3px teal focus rings, keyboard-dismissable popovers, `[hidden]` enforced with `!important`.
- Target: WCAG AA. ❓ Confirm; muted `#BCC4D0` on `#262B2F` passes for normal text, but verify chart text at 12px against `#202428`.

### Branding assets
`assets/favicon.svg` is the site mark (owner-picked 2026-11-03): a diagonal RAM stick with heartbeat trace and solid teal contact strip on a charcoal tile, wired as tab favicon (SVG + 32px PNG fallback + apple-touch PNG) and used in the header and empty state. Series colors remain chart-only. The older candidate marks stay in `assets/` unused; remove once the owner confirms.

## 7. Content & voice

- Tone: precise, technical, second person ("your deck"), unafraid of disclaimers. The legalistic limit notes are intentional content, not boilerplate.
- Structure: hint text under controls; `i` popovers for definitions; warnings block at the end of results; formula block showing the actual math.
- Every simulated number ships with its sample size or interval context.

### Voice principles (added 2026-11-03, for the new-player audience)
- Name the mechanic, then explain it in one sentence. Example for the renamed control: "**Simulated RAM budget** — how much RAM the simulated player builds each game before switching to drawing cards. Automatic plays test games and picks the budget that reaches tiers soonest."
- Prefer "simulated" for Monte Carlo numbers, "exact" for combinatorial numbers; never let the two blend without labels.
- Disclaimers stay plain-spoken, not legalistic: "Your deck stays in this browser."

## 8. Open questions for the owner

Answered 2026-11-03 (recorded in §1, §2, §5, §6): ambition = web-hosted player tool; audience = players new and old; catalog = static, manual updates; styling = locked except a simpler RAM mark/favicon.

Still open:
1. **Max turns bounds** — proposed: free numeric input, 1–40, default 12. Confirm the ceiling.
2. **RAM strategy rename** — proposed new label "Simulated RAM budget" (copy in §4). Approve or offer alternative.
3. **New RAM mark direction** — evolve `logo-ram-core.svg` (chip + pins, no module outline) or design fresh? Any element that must survive (teal + charcoal palette is assumed retained).
4. **Fidelity roadmap** — is "structural only" permanent, or are printed draw/tutor/ramp effects (the biggest curve-distorters) a planned modeling layer?
5. **Distribution** — GitHub Pages remains the home; URL sharing declined (owner, 2026-11-03). Export preferences instead: PNG and/or copyable stats — pick format when prioritized.
