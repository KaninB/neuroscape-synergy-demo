/* Offline parser, exact draw math, and structural simulator for the static page. */
(function (root) {
  'use strict';

  const RAM_TARGETS = [3, 4, 6, 8, 10, 12, 16, 20];
  const LIMITS = 'Structural estimate: printed abilities, tokens, attacks, and lethal endings are omitted. Play policy is heuristic.';
  const key = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('en-US');
  const label = value => key(value).replace(/[\s_-]+/g, ' ');

  function catalogIndex(catalog) {
    const byName = new Map();
    for (const card of catalog.cards) {
      byName.set(key(card.name), card);
      byName.set(key(card.id), card);
    }
    return byName;
  }

  function parseEntry(line, lineNumber) {
    let match = line.match(/^\s*(\d+)\s*,\s*(.+?)\s*$/);
    if (match) return { count: Number(match[1]), name: match[2] };
    match = line.match(/^\s*(\d+)\s*[xX×]?\s+(.+?)\s*$/);
    if (match) return { count: Number(match[1]), name: match[2] };
    match = line.match(/^\s*(.+?)\s*,\s*(\d+)\s*$/);
    if (match) return { count: Number(match[2]), name: match[1] };
    match = line.match(/^\s*(.+?)\s+[xX×](\d+)\s*$/);
    if (match) return { count: Number(match[2]), name: match[1] };
    if (/^\d+$/.test(line.trim())) throw new Error(`Line ${lineNumber}: add a card name after the count`);
    return { count: 1, name: line.trim() };
  }

  function sectionName(line) {
    const match = line.match(/^\s*#\s*(.+?)\s*$/);
    if (!match) return null;
    const name = label(match[1]);
    if (name === 'MAINFRAME') return 'mainframe';
    if (name === 'CYBERDECK' || name === 'MAIN DECK') return 'cyberdeck';
    if (name === 'SIDEBOARD') return 'sideboard';
    if (name === 'SIDEBOARD MAINFRAME') return 'sideboard_mainframe';
    if (name === 'RAM' || name === 'RAM DECK') return 'ram';
    return 'comment';
  }

  function parseDecklist(text, catalog) {
    const byName = catalogIndex(catalog);
    const errors = [], warnings = [], counts = new Map();
    const zones = { cyberdeck: 0, sideboard: 0, ram: 0 };
    let mainframe = null, zone = 'cyberdeck', hasSections = false;
    const sections = new Set();
    const lines = String(text || '').replace(/^\ufeff/, '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('//')) continue;
      const heading = sectionName(line);
      if (heading) {
        if (heading !== 'comment') { zone = heading; hasSections = true; sections.add(heading); }
        continue;
      }
      if (line.startsWith('#')) continue;
      if (/^(count|quantity)\s*,\s*(name|card name)$/i.test(line) ||
          /^(name|card name)\s*,\s*(count|quantity)$/i.test(line)) continue;
      let entry;
      try { entry = parseEntry(line, i + 1); }
      catch (error) { errors.push(error.message); continue; }
      if (!Number.isSafeInteger(entry.count) || entry.count < 1) {
        errors.push(`Line ${i + 1}: copy count must be a positive integer`); continue;
      }
      const card = byName.get(key(entry.name));
      if (zone === 'mainframe') {
        if (!card || card.type !== 'MAINFRAME') {
          errors.push(`Line ${i + 1}: ${entry.name} is not a known Mainframe`);
        } else if (entry.count !== 1) {
          errors.push(`Line ${i + 1}: the Mainframe section must contain one card`);
        } else if (mainframe && mainframe.id !== card.id) {
          errors.push(`Line ${i + 1}: more than one primary Mainframe was found`);
        } else mainframe = card;
        continue;
      }
      if (zone === 'sideboard' || zone === 'ram') { zones[zone] += entry.count; continue; }
      if (zone === 'sideboard_mainframe') continue;
      if (card && card.type === 'MAINFRAME') {
        if (entry.count !== 1) errors.push(`Line ${i + 1}: include one Mainframe`);
        else if (mainframe && mainframe.id !== card.id) errors.push(`Line ${i + 1}: two different Mainframes were found`);
        else mainframe = card;
        continue;
      }
      zones.cyberdeck += entry.count;
      if (!card) {
        errors.push(`Line ${i + 1}: unknown cyberdeck card “${entry.name}”`); continue;
      }
      if (card.type === 'RAM') {
        errors.push(`Line ${i + 1}: ${card.name} is RAM; place it in the RAM section`); continue;
      }
      if (card.type === 'MAINFRAME') continue;
      const next = (counts.get(card.id) || 0) + entry.count;
      counts.set(card.id, next);
      if (card.copy_limit !== null && next > card.copy_limit)
        errors.push(`Line ${i + 1}: ${card.name} has ${next} copies; the limit is ${card.copy_limit}`);
    }
    const entries = [...counts].map(([id, copies]) => {
      const card = catalog.cards.find(item => item.id === id);
      return { card_id: id, name: card.name, copies };
    }).sort((a, b) => a.name.localeCompare(b.name));
    const deck = entries.flatMap(entry => Array(entry.copies).fill(byName.get(key(entry.card_id))));
    if (zones.cyberdeck !== deck.length && !errors.length)
      errors.push('Some cyberdeck cards could not be counted');
    if (zones.cyberdeck < 50 || zones.cyberdeck > 255)
      warnings.push(`Cyberdeck has ${zones.cyberdeck} cards; the legal range is 50–255.`);
    return { deck, entries, deckCount: zones.cyberdeck, uniqueCount: entries.length,
      sideboardCount: zones.sideboard, ramCount: zones.ram, mainframe, hasSections,
      sections: [...sections],
      errors: [...new Set(errors)], warnings };
  }

  function choose(n, k) {
    if (k < 0 || k > n) return 0;
    k = Math.min(k, n - k);
    let value = 1;
    for (let i = 1; i <= k; i++) value *= (n - k + i) / i;
    return value;
  }

  function exactDrawCurve(deck, tier, boardRequirement = tier.board_requirement, maxSeen = 20) {
    const factions = Object.keys(tier.faction_requirements);
    const needs = factions.map(faction => tier.faction_requirements[faction]);
    const groups = new Map();
    for (const card of deck) {
      const persistent = card.persistent ? 1 : 0;
      const icons = factions.map(faction => card.factions.filter(f => f === faction).length);
      const groupKey = [persistent, ...icons].join('|');
      const group = groups.get(groupKey) || { persistent, icons, copies: 0 };
      group.copies++;
      groups.set(groupKey, group);
    }
    let dp = new Map([['0|0|' + needs.map(() => 0).join('|'),
      { drawn: 0, board: 0, counts: needs.map(() => 0), ways: 1 }]]);
    for (const group of groups.values()) {
      const next = new Map();
      for (const state of dp.values()) {
        for (let taken = 0; taken <= Math.min(group.copies, maxSeen - state.drawn); taken++) {
          const drawn = state.drawn + taken;
          const board = Math.min(boardRequirement, state.board + taken * group.persistent);
          const counts = needs.map((need, i) => Math.min(need, state.counts[i] + taken * group.icons[i]));
          const stateKey = [drawn, board, ...counts].join('|');
          const ways = state.ways * choose(group.copies, taken);
          if (next.has(stateKey)) next.get(stateKey).ways += ways;
          else next.set(stateKey, { drawn, board, counts, ways });
        }
      }
      dp = next;
    }
    const probabilities = [];
    for (let seen = 5; seen <= maxSeen; seen++) {
      const target = [seen, boardRequirement, ...needs].join('|');
      probabilities.push({ cards_seen: seen,
        probability: Math.max(0, Math.min(1, (dp.get(target)?.ways || 0) / choose(deck.length, seen))) });
    }
    return probabilities;
  }

  function drawReference(deck, mainframe) {
    const rows = [];
    for (const tier of mainframe.tiers) {
      const faction = exactDrawCurve(deck, tier, 0);
      const joint = exactDrawCurve(deck, tier);
      for (let i = 0; i < faction.length; i++) rows.push({ tier: tier.tier,
        cards_seen: faction[i].cards_seen,
        faction_only_probability: faction[i].probability,
        joint_threshold_probability: joint[i].probability });
    }
    return rows;
  }

  function randomGenerator(seed) {
    let x = seed >>> 0 || 0x9e3779b9;
    return () => {
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      return (x >>> 0) / 4294967296;
    };
  }

  function hash32(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function shuffle(deck, seed) {
    const random = randomGenerator(seed), cards = deck.slice();
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
  }

  function synergy(state) {
    const counts = {};
    for (const object of state.board) for (const faction of object.card.factions)
      counts[faction] = (counts[faction] || 0) + 1;
    return counts;
  }

  function checkTiers(state, turn) {
    const counts = synergy(state);
    for (const tier of state.mainframe.tiers) {
      if (state.reached[tier.tier] !== undefined || state.board.length < tier.board_requirement) continue;
      if (Object.entries(tier.faction_requirements).every(([faction, needed]) => (counts[faction] || 0) >= needed))
        state.reached[tier.tier] = turn;
    }
  }

  function legalHosts(state, gear) {
    const result = [];
    for (const object of state.board) {
      if (object.card.type !== 'CHARACTER') continue;
      for (const [region, needed] of Object.entries(gear.ports)) {
        if (!object.usedPorts.includes(region) && (object.card.ports[region] || 0) >= needed)
          result.push([object, region]);
      }
    }
    return result;
  }

  function canPlay(state, card, counts = null) {
    if (!card.persistent || card.cost === null || card.cost > state.ramFree) return false;
    counts ||= synergy(state);
    if (Object.entries(card.requirements).some(([faction, needed]) => (counts[faction] || 0) < needed)) return false;
    if (card.iconic && state.board.some(object => object.card.name === card.name)) return false;
    if (card.type === 'GEAR' && !legalHosts(state, card).length) return false;
    if (card.subtype === 'PROTOCOL' && state.board.filter(object => object.card.subtype === 'PROTOCOL').length >= 3) return false;
    if (card.subtype === 'ENVIRONMENT' && state.board.some(object => object.card.subtype === 'ENVIRONMENT')) return false;
    return true;
  }

  function play(state, card, turn) {
    state.ramFree -= card.cost;
    const committedRam = card.type === 'CHARACTER' ? card.cost : 0;
    if (card.type === 'CHARACTER') state.ramCommitted += card.cost;
    let hostId = null;
    if (card.type === 'GEAR') {
      const [host, region] = legalHosts(state, card)[0];
      host.usedPorts.push(region); hostId = host.id;
    }
    state.hand.splice(state.hand.indexOf(card), 1);
    state.board.push({ id: state.nextBoardId++, card, usedPorts: [], committedRam, hostId });
    checkTiers(state, turn);
  }

  function forceQuit(state, object) {
    state.board = state.board.filter(current => current.id !== object.id && current.hostId !== object.id);
    state.ramCommitted -= object.committedRam;
    state.ramFree += object.committedRam;
    state.forceQuits++;
  }

  function cloneState(state) {
    return { ...state, hand: state.hand.slice(), deck: state.deck.slice(),
      board: state.board.map(object => ({ ...object, usedPorts: object.usedPorts.slice() })),
      reached: { ...state.reached } };
  }

  function progressScore(state) {
    const counts = synergy(state);
    let score = 0;
    for (const tier of state.mainframe.tiers) {
      if (state.reached[tier.tier] !== undefined) { score += 4; continue; }
      const board = Math.min(1, state.board.length / tier.board_requirement);
      const total = Object.values(tier.faction_requirements).reduce((a, b) => a + b, 0);
      const faction = Object.entries(tier.faction_requirements)
        .reduce((sum, [f, n]) => sum + Math.min(counts[f] || 0, n), 0) / total;
      score += board + faction;
    }
    return score;
  }

  function usefulness(card, state, counts = null) {
    counts ||= synergy(state);
    let gain = 0;
    for (const tier of state.mainframe.tiers) {
      if (state.reached[tier.tier] !== undefined) continue;
      if (state.board.length < tier.board_requirement) gain++;
      for (const [faction, needed] of Object.entries(tier.faction_requirements)) {
        const icons = card.factions.filter(f => f === faction).length;
        gain += Math.min(icons, Math.max(0, needed - (counts[faction] || 0)));
      }
    }
    const hostBonus = card.type === 'CHARACTER' && Object.keys(card.ports).length ? .25 : 0;
    return gain + hostBonus - .12 * (card.cost || 0);
  }

  function deploy(state, turn) {
    for (;;) {
      const counts = synergy(state);
      let chosen = null, best = -Infinity;
      for (const card of state.hand) {
        if (!canPlay(state, card, counts)) continue;
        const value = usefulness(card, state, counts);
        if (value > best) { best = value; chosen = card; }
      }
      if (!chosen || best <= 0) return;
      play(state, chosen, turn);
    }
  }

  function chooseForceQuits(state, turn) {
    if (!state.board.some(object => object.card.type === 'CHARACTER' && object.committedRam > 0)) return;
    if (state.hand.filter(card => card.persistent).reduce((sum, card) => sum + (card.cost || 0), 0) <= state.ramFree) return;
    for (let attempt = 0; attempt < 2; attempt++) {
      const baseline = cloneState(state); deploy(baseline, turn);
      let bestValue = progressScore(baseline), bestId = null;
      const characters = state.board.filter(object => object.card.type === 'CHARACTER' && object.committedRam > 0);
      for (const object of characters) {
        if (!state.hand.some(card => card.persistent && card.cost !== null)) continue;
        const hypothetical = cloneState(state);
        const target = hypothetical.board.find(item => item.id === object.id);
        forceQuit(hypothetical, target); deploy(hypothetical, turn);
        const value = progressScore(hypothetical);
        if (value > bestValue + .05) { bestValue = value; bestId = object.id; }
      }
      if (bestId === null) return;
      forceQuit(state, state.board.find(object => object.id === bestId));
    }
  }

  function drawOrInstall(state, ramTarget) {
    if (!state.ramInstalled) return 'install';
    if (state.ramInstalled >= ramTarget || state.ramInstalled >= 25) return 'draw';
    const relevant = state.hand.filter(card => card.persistent && card.cost !== null);
    if (relevant.length && (state.ramFree === 0 || relevant.some(card => card.cost > state.ramFree) || state.hand.length >= 3))
      return 'install';
    return 'draw';
  }

  function simulate(deck, mainframe, first, seed, turns, ramTarget) {
    const shuffled = shuffle(deck, seed);
    let hand = Array.from({ length: 5 }, () => shuffled.pop());
    const relevant = new Set(mainframe.tiers.flatMap(tier => Object.keys(tier.faction_requirements)));
    const keep = hand.filter(card => card.persistent && card.cost !== null && card.cost <= 2 &&
      card.factions.some(faction => relevant.has(faction)));
    if (keep.length < 3) {
      const bottom = hand.filter(card => !keep.includes(card));
      hand = keep.concat(Array.from({ length: bottom.length }, () => shuffled.pop()));
      shuffled.unshift(...bottom);
    }
    const state = { mainframe, hand, deck: shuffled, board: [], nextBoardId: 1,
      ramInstalled: 0, ramCommitted: 0, ramFree: 0, reached: {}, forceQuits: 0 };
    for (let turn = 1; turn <= turns; turn++) {
      state.ramFree = state.ramInstalled - state.ramCommitted;
      const choices = first && turn === 1 ? 1 : 2;
      for (let action = 0; action < choices; action++) {
        if (drawOrInstall(state, ramTarget) === 'install' && state.ramInstalled < 25) {
          state.ramInstalled++; state.ramFree++;
        } else if (state.deck.length) state.hand.push(state.deck.pop());
      }
      chooseForceQuits(state, turn);
      deploy(state, turn);
      if (Object.keys(state.reached).length === mainframe.tiers.length) break;
    }
    return state;
  }

  function wilson(successes, trials) {
    const z = 1.959963984540054, p = successes / trials, d = 1 + z * z / trials;
    const center = (p + z * z / (2 * trials)) / d;
    const radius = z / d * Math.sqrt(p * (1 - p) / trials + z * z / (4 * trials * trials));
    return [successes ? Math.max(0, center - radius) : 0,
      successes === trials ? 1 : Math.min(1, center + radius)];
  }

  function sourceSummary(deck, tier) {
    const factions = Object.keys(tier.faction_requirements);
    const sources = deck.filter(card => card.persistent && card.factions.some(f => factions.includes(f)));
    const costs = {}, types = {}, icons = {};
    for (const faction of factions) icons[faction] = deck.filter(card => card.persistent)
      .reduce((sum, card) => sum + card.factions.filter(f => f === faction).length, 0);
    for (const card of sources) {
      costs[card.cost] = (costs[card.cost] || 0) + 1;
      types[card.type] = (types[card.type] || 0) + 1;
    }
    return { persistent_cards: deck.filter(card => card.persistent).length,
      script_cards: deck.filter(card => card.type === 'PROGRAM' && card.subtype === 'SCRIPT').length,
      source_cards: sources.length, source_fraction: sources.length / deck.length,
      source_by_ram_cost: costs, source_by_type: types, icons_by_faction: icons,
      multi_required_faction_sources: sources.filter(card => factions.filter(f => card.factions.includes(f)).length >= 2).length };
  }

  const yieldFrame = () => new Promise(resolve => setTimeout(resolve, 0));
  async function analyze(parsed, mainframe, settings = {}, progress = () => {}) {
    if (parsed.errors.length) throw new Error(parsed.errors.join('\n'));
    if (parsed.deckCount < 50 || parsed.deckCount > 255) throw new Error(`Cyberdeck has ${parsed.deckCount} cards; legal size is 50–255`);
    if (!mainframe || mainframe.type !== 'MAINFRAME') throw new Error('Choose a Mainframe');
    const deck = parsed.deck, turns = Number(settings.turns || 12), trials = Number(settings.trials || 250);
    if (![12, 20].includes(turns) || !Number.isInteger(trials) || trials < 50 || trials > 5000)
      throw new Error('Select 12 or 20 turns and 50–5,000 trials per position');
    const signature = `${mainframe.id}|${parsed.entries.map(row => `${row.card_id}:${row.copies}`).join('|')}`;
    const seed = hash32(signature);
    progress({ phase: 'Calculating exact draw odds', completed: 0, total: 1 });
    const drawOnly = drawReference(deck, mainframe);
    await yieldFrame();
    const requestedTarget = settings.ram_target === 'auto' || settings.ram_target == null ? null : Number(settings.ram_target);
    if (requestedTarget !== null && (!Number.isInteger(requestedTarget) || requestedTarget < 1 || requestedTarget > 25))
      throw new Error('RAM target must be 1–25');
    const pilotTrials = requestedTarget === null ? 12 : 0;
    const total = 2 * trials + RAM_TARGETS.length * 2 * pilotTrials;
    let completed = 0, ramTarget = requestedTarget;
    const pilotScores = [];
    if (ramTarget === null) {
      const horizon = Math.min(12, turns);
      for (const target of RAM_TARGETS) {
        let score = 0;
        for (const first of [true, false]) for (let trial = 0; trial < pilotTrials; trial++) {
          const state = simulate(deck, mainframe, first, seed + trial, horizon, target);
          for (const tier of mainframe.tiers) {
            const hit = state.reached[tier.tier];
            if (hit !== undefined && hit <= horizon) score += horizon - hit + 1;
          }
          completed++;
        }
        pilotScores.push({ ram_target: target, score: score / (2 * pilotTrials * mainframe.tiers.length * horizon) });
        progress({ phase: 'Selecting RAM policy', completed, total, ram_target: target });
        await yieldFrame();
      }
      pilotScores.sort((a, b) => b.score - a.score || a.ram_target - b.ram_target);
      ramTarget = pilotScores[0].ram_target;
    }
    const hits = new Map(), quits = { first: 0, second: 0 }, quitTotals = { first: 0, second: 0 };
    const stride = Math.max(1, Math.min(25, Math.floor(trials / 20)));
    for (const position of ['first', 'second']) {
      for (let trial = 0; trial < trials; trial++) {
        const state = simulate(deck, mainframe, position === 'first', seed + 1000000 + trial, turns, ramTarget);
        quits[position] += state.forceQuits > 0 ? 1 : 0;
        quitTotals[position] += state.forceQuits;
        for (const tier of mainframe.tiers) {
          const hit = state.reached[tier.tier];
          if (hit !== undefined) for (let turn = hit; turn <= turns; turn++) {
            const k = `${tier.tier}|${position}|${turn}`;
            hits.set(k, (hits.get(k) || 0) + 1);
          }
        }
        completed++;
        if ((trial + 1) % stride === 0 || trial + 1 === trials) {
          progress({ phase: 'Simulating turn curves', completed, total, position });
          await yieldFrame();
        }
      }
    }
    const curves = [];
    for (const tier of mainframe.tiers) for (const position of ['first', 'second'])
      for (let turn = 1; turn <= turns; turn++) {
        const reached = hits.get(`${tier.tier}|${position}|${turn}`) || 0;
        const [low, high] = wilson(reached, trials);
        curves.push({ tier: tier.tier, position, turn, reached_count: reached,
          trials, probability: reached / trials, wilson_95_low: low, wilson_95_high: high });
      }
    const summaries = {};
    for (const tier of mainframe.tiers) summaries[tier.tier] = sourceSummary(deck, tier);
    const warnings = [LIMITS];
    if (deck.some(card => card.type === 'PROGRAM' && card.subtype === 'SCRIPT'))
      warnings.push('Scripts are included as draws; their printed effects are not simulated.');
    if (deck.some(card => card.has_ability)) warnings.push('Printed abilities on deck cards are not executed.');
    return { model: 'structural_force_quit_static_web', catalog_sha256: root.NEUROSCAPE_CATALOG?.catalog_sha256,
      mainframe: { id: mainframe.id, name: mainframe.name, tiers: mainframe.tiers },
      deck_size: deck.length, deck_signature: signature, deck_entries: parsed.entries,
      source_summary_by_tier: summaries,
      settings: { trials_per_position: trials, turns, ram_target: ramTarget,
        ram_target_selection: requestedTarget === null ? 'equal-tier/equal-turn pilot' : 'manual',
        pilot_trials_per_position_per_target: pilotTrials, pilot_scores: pilotScores },
      draw_only: drawOnly, curves,
      force_quit: Object.fromEntries(['first', 'second'].map(position => [position,
        { share_trials_with_quit: quits[position] / trials, mean_character_quits: quitTotals[position] / trials }])),
      warnings };
  }

  const api = { parseDecklist, exactDrawCurve, drawReference, simulate, analyze,
    sourceSummary, catalogIndex, choose, wilson, hash32 };
  root.NEUROSCAPE_ENGINE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
