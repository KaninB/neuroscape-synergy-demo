# Neuroscape synergy curve demo

An unofficial, browser-only calculator for exploring when a deck reaches its Mainframe synergy requirements. Paste an AZ Universe deck export or load the example deck at the [live demo](https://kaninb.github.io/neuroscape-synergy-demo/).

The exact draw panels use without-replacement combinatorics. The turn panels use a structural simulation with RAM, costs, faction gates, gear hosts and ports, persistent slots, and character force quits. Printed card effects, tokens, combat, and lethal endings are not modeled. Treat the turn curves as estimates, not full-game probabilities.

The page runs without a server. Decklists and results stay in the browser unless the visitor downloads a JSON result. The four files needed to host it are `index.html`, `app.js`, `engine.js`, and `catalog.js`.
