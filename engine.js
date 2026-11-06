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
      if (Object.entries(tier.faction_requirements).every(([faction, needed]) => (counts[faction] || 0) >= needed)) {
        state.reached[tier.tier] = turn;
        (state.tierRam = state.tierRam || {})[tier.tier] = { installed: state.ramInstalled, free: state.ramFree };
      }
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
    // First time this card got played (splash payoff telemetry; cheap, always on).
    if (state.reqTurns[card.id] === undefined) state.reqTurns[card.id] = turn;
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
      if (state.reached[tier.tier] !== undefined) { gain += 4; continue; }
      if (state.board.length < tier.board_requirement) gain++;
      for (const [faction, needed] of Object.entries(tier.faction_requirements)) {
        const icons = card.factions.filter(f => f === faction).length;
        gain += Math.min(icons, Math.max(0, needed - (counts[faction] || 0)));
      }
    }
    // Splash payoffs: when a package is tracked, progress toward its printed
    // requirements counts too, and playing an unplayed payoff itself is worth
    // a bonus. Without this the policy never deploys splash pieces (they earn
    // zero tier progress) and splash curves would always read zero.
    if (state.splashPayoffs) for (const payoff of state.splashPayoffs) {
      if (state.reqTurns[payoff.id] !== undefined) continue;
      if (payoff.id === card.id) { gain += 1.5; continue; }
      for (const [faction, needed] of Object.entries(payoff.requirements || {})) {
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

  function simulate(deck, mainframe, first, seed, turns, ramTarget, splash) {
    const shuffled = shuffle(deck, seed);
    let hand = Array.from({ length: 5 }, () => shuffled.pop());
    const relevant = new Set(mainframe.tiers.flatMap(tier => Object.keys(tier.faction_requirements)));
    // A splash package's pieces are load-bearing too: the opening-hand keep
    // rule protects them the same way it protects tier pieces.
    if (splash) for (const faction of splash.factions) relevant.add(faction);
    const keep = hand.filter(card => card.persistent && card.cost !== null && card.cost <= 2 &&
      card.factions.some(faction => relevant.has(faction)));
    if (keep.length < 3) {
      const bottom = hand.filter(card => !keep.includes(card));
      hand = keep.concat(Array.from({ length: bottom.length }, () => shuffled.pop()));
      shuffled.unshift(...bottom);
    }
    const state = { mainframe, hand, deck: shuffled, board: [], nextBoardId: 1,
      ramInstalled: 0, ramCommitted: 0, ramFree: 0, reached: {}, tierRam: {}, forceQuits: 0,
      reqTurns: {}, boardIcons: splash ? {} : null, splashPayoffs: splash ? splash.payoffs : null };
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
      // End-of-turn faction icons on the board (splash resource telemetry).
      if (state.boardIcons) state.boardIcons[turn] = synergy(state);
      if (Object.keys(state.reached).length === mainframe.tiers.length) {
        // The game is over; carry the final board forward so cumulative
        // splash curves stay defined through the full horizon.
        if (state.boardIcons)
          for (let rest = turn + 1; rest <= turns; rest++) state.boardIcons[rest] = state.boardIcons[turn];
        break;
      }
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

  // Splash packages: factions the deck plays that this Mainframe's tiers
  // never ask for. Payoff candidates are the requirement-bearing cards in
  // those factions — Scripts count as payoffs too (they get PLAYED, they
  // just never go "online" like persistent cards do).
  function detectSplashPackages(deck, mainframe) {
    const tierFactions = new Set(mainframe.tiers.flatMap(tier => Object.keys(tier.faction_requirements)));
    const byFaction = {};
    for (const card of deck) {
      if (card.type === 'MAINFRAME') continue;
      for (const faction of card.factions) {
        if (tierFactions.has(faction)) continue;
        const bucket = byFaction[faction] || (byFaction[faction] = { copies: 0, payoffs: new Map() });
        bucket.copies++;
        if (Object.keys(card.requirements || {}).length)
          bucket.payoffs.set(card.id, card);
      }
    }
    return Object.entries(byFaction)
      .map(([faction, bucket]) => ({ faction, cards: bucket.copies,
        payoffs: [...bucket.payoffs.values()] }))
      .filter(pkg => pkg.cards >= 3)
      .sort((a, b) => b.cards - a.cards);
  }

  // Splash-tax filler: a synthetic cost-matched neutral character. The swap
  // removes the package's faction icons while preserving its RAM profile, so
  // the A/B isolates faction value rather than cost difference.
  function taxFiller(swapped) {
    const costs = swapped.map(card => card.cost).filter(cost => cost !== null).sort((a, b) => a - b);
    const cost = costs.length ? costs[Math.floor((costs.length - 1) / 2)] : 1;
    return { id: 'TAX-FILLER', name: 'Neutral filler', type: 'CHARACTER', subtype: '', cost,
      factions: [], requirements: {}, ports: {}, iconic: false, persistent: true,
      copy_limit: 999, has_ability: false, tiers: [] };
  }

  const AZUNIVERSE_DECK_URL = /^https?:\/\/([a-z0-9-]+\.)?azuniverse\.net\/decks\/([A-Za-z0-9]+)\/?([?#].*)?$/;
  // Find the first balanced JSON object in a text blob (used when a relay
  // wraps the payload in markdown or HTML).
  function jsonFromLooseText(text) {
    const start = text.indexOf('{');
    if (start < 0) return null;
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (!depth) {
          try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
        }
      }
    }
    return null;
  }

  // Convert an azuniverse.net deck API payload into decklist text.
  // Tolerates relays that wrap the JSON in markdown or HTML.
  // Throws with a friendly message when the payload is not a usable deck.
  function decklistFromAzuniverse(payload) {
    let data = null;
    if (typeof payload === 'string') {
      try { data = JSON.parse(payload); } catch { data = jsonFromLooseText(payload); }
    } else data = payload;
    if (!data || typeof data !== 'object' || !Array.isArray(data.items))
      throw new Error('the response did not contain a deck list');
    const lines = [];
    if (data.mainframeCard && data.mainframeCard.name) lines.push(`1 ${data.mainframeCard.name}`);
    lines.push('#CYBERDECK');
    let count = 0;
    for (const item of data.items) {
      if (!item || !item.card || !item.card.name || !Number.isInteger(item.quantity)) continue;
      if (item.section === 'ram') continue;
      lines.push(`${item.quantity} ${item.card.name}`);
      count += item.quantity;
    }
    const sideboard = data.items.filter(item => item.section === 'sideboard' && item.card && item.card.name);
    if (sideboard.length) {
      lines.push('#SIDEBOARD');
      for (const item of sideboard) lines.push(`${item.quantity} ${item.card.name}`);
    }
    if (!count) throw new Error('the deck contains no Cyberdeck cards');
    return lines.join('\n');
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
    // `turns` is the absolute final own turn shown on every curve: the
    // horizon (default 6 own turns) plus any extra study turns the caller adds.
    const deck = parsed.deck, turns = Number(settings.turns || 6), trials = Number(settings.trials || 5000);
    if (!Number.isInteger(turns) || turns < 1 || turns > 40) throw new Error('Turn horizon must be a whole number from 1 to 40');
    if (!Number.isInteger(trials) || trials < 50 || trials > 5000)
      throw new Error('Select 50–5,000 trials per position');
    const signature = `${mainframe.id}|${parsed.entries.map(row => `${row.card_id}:${row.copies}`).join('|')}`;
    const seed = hash32(signature);
    // Splash tracking: settings.splash_factions lists the deck factions the
    // caller wants tracked as splash packages (empty/absent = off). A chosen
    // faction is valid when the Mainframe's tiers don't already require it;
    // its payoff candidates are the requirement-bearing cards in that faction.
    const tierFactions = new Set(mainframe.tiers.flatMap(tier => Object.keys(tier.faction_requirements)));
    const splashFactions = [...new Set((Array.isArray(settings.splash_factions) ? settings.splash_factions : [])
      .filter(f => typeof f === 'string' && f && !tierFactions.has(f)))];
    const splashSelection = splashFactions.length ? {
      factions: splashFactions,
      payoffs: [...new Map(deck.filter(card => splashFactions.some(f => card.factions.includes(f))
        && Object.keys(card.requirements || {}).length).map(card => [card.id, card])).values()]
        .sort((a, b) => a.name.localeCompare(b.name)),
      thresholds: [...new Set(deck.filter(card => splashFactions.some(f => card.factions.includes(f)))
        .flatMap(card => Object.values(card.requirements || {})))].sort((a, b) => a - b)
    } : null;
    progress({ phase: 'Calculating exact draw odds', completed: 0, total: 1 });
    const drawOnly = drawReference(deck, mainframe);
    await yieldFrame();
    const requestedTarget = settings.ram_target === 'auto' || settings.ram_target == null ? null : Number(settings.ram_target);
    if (requestedTarget !== null && (!Number.isInteger(requestedTarget) || requestedTarget < 1 || requestedTarget > 25))
      throw new Error('RAM target must be 1–25');
    const pilotTrials = requestedTarget === null ? 12 : 0;
    const pilotTotal = RAM_TARGETS.length * 2 * pilotTrials;
    let ramTarget = requestedTarget;
    const pilotScores = [];
    let splashFloor = false;
    if (ramTarget === null) {
      const horizon = Math.min(6, turns);
      let pilotCompleted = 0;
      for (const target of RAM_TARGETS) {
        let score = 0;
        for (const first of [true, false]) for (let trial = 0; trial < pilotTrials; trial++) {
          const state = simulate(deck, mainframe, first, seed + trial, horizon, target,
            splashSelection ? { factions: splashSelection.factions, payoffs: splashSelection.payoffs } : null);
          for (const tier of mainframe.tiers) {
            const hit = state.reached[tier.tier];
            if (hit !== undefined && hit <= horizon) score += horizon - hit + 1;
          }
          // When a splash package is tracked, its persistent payoffs coming
          // online also counts toward a budget's score (softened so the
          // Mainframe's own tiers stay primary). Otherwise the auto budget
          // never leaves room for expensive payoffs like a cost-7 environment.
          if (splashSelection) for (const payoff of splashSelection.payoffs) {
            if (!payoff.persistent) continue;
            const hit = state.reqTurns[payoff.id];
            if (hit !== undefined) score += (horizon - hit + 1) / (splashSelection.payoffs.length + 1);
          }
          pilotCompleted++;
        }
        pilotScores.push({ ram_target: target, score: score / (2 * pilotTrials * mainframe.tiers.length * horizon) });
        progress({ phase: 'Testing RAM budgets', stage: 'pilot', completed: pilotCompleted, total: pilotTotal, ram_target: target });
        await yieldFrame();
      }
      pilotScores.sort((a, b) => b.score - a.score || a.ram_target - b.ram_target);
      ramTarget = pilotScores[0].ram_target;
      // A tracked splash package may carry payoffs pricier than the
      // tier-optimal budget would ever afford (a cost-7 environment under a
      // budget of 4 never deploys, so its curve would read zero for budget
      // reasons, not deck reasons). A player running the package builds RAM
      // to cast it, so raise the budget to the priciest persistent payoff
      // (capped at 16) and disclose the raise.
      if (splashSelection) {
        const costs = splashSelection.payoffs.filter(card => card.persistent)
          .map(card => card.cost).filter(cost => cost !== null);
        if (costs.length) {
          const floor = Math.min(16, Math.max(...costs));
          if (ramTarget < floor) { ramTarget = floor; splashFloor = true; }
        }
      }
    }
    const hits = new Map(), quits = { first: 0, second: 0 }, quitTotals = { first: 0, second: 0 };
    const ramAtTier = { first: {}, second: {} };  // tier -> {installed: [...], free: [...]}
    const stride = Math.max(1, Math.min(25, Math.floor(trials / 20)));
    // Splash telemetry accumulators: payoff play/online turns, end-of-turn
    // board icons for the package faction, and (optional) splash-tax rerun.
    const splash = splashSelection;
    const payoffs = splash ? splash.payoffs : [];
    const factions = splash ? splash.factions : [];
    const reqHits = new Map(), iconTotals = {}, iconAtLeast = {};
    const firstHitTurns = new Map();  // card|position -> {turn -> count, never: count}
    // Installed RAM at the moment the first persistent splash payoff came
    // online — the splash variant of the tier RAM histograms.
    const ramAtSplash = { first: [], second: [] };
    const splashPersistent = payoffs.filter(card => card.persistent);
    const thresholds = splash ? splash.thresholds : [];
    // First-play telemetry for EVERY requirement-bearing card in the deck
    // (not just tracked splash payoffs): the requirement table shows when any
    // card's printed requirement was satisfiable-and-played, even untracked.
    const reqCards = [...new Map(deck.filter(card => Object.keys(card.requirements || {}).length)
      .map(card => [card.id, card])).values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const position of ['first', 'second']) {
      iconTotals[position] = {}; iconAtLeast[position] = {};
      for (let turn = 1; turn <= turns; turn++) {
        iconTotals[position][turn] = 0;
        iconAtLeast[position][turn] = {};
        for (const needed of thresholds) iconAtLeast[position][turn][needed] = 0;
      }
    }
    for (const position of ['first', 'second']) {
      for (let trial = 0; trial < trials; trial++) {
        const state = simulate(deck, mainframe, position === 'first', seed + 1000000 + trial, turns, ramTarget,
          splash ? { factions, payoffs } : null);
        for (const card of reqCards) {
          const hit = state.reqTurns[card.id];
          const hk = `${card.id}|${position}`;
          const bucket = firstHitTurns.get(hk) || firstHitTurns.set(hk, { never: 0 }).get(hk);
          if (hit !== undefined) {
            for (let turn = hit; turn <= turns; turn++) {
              const k = `${card.id}|${position}|${turn}`;
              reqHits.set(k, (reqHits.get(k) || 0) + 1);
            }
            bucket[hit] = (bucket[hit] || 0) + 1;
          } else {
            bucket.never++;
          }
        }
        if (splash) {
          if (splashPersistent.length) {
            const firstHit = Math.min(...splashPersistent.map(card => state.reqTurns[card.id]).filter(t => t !== undefined));
            if (Number.isFinite(firstHit)) ramAtSplash[position].push(state.ramInstalled);
          }
          for (let turn = 1; turn <= turns; turn++) {
            const counts = state.boardIcons[turn] || {};
            let total = 0;
            for (const faction of factions) total += counts[faction] || 0;
            iconTotals[position][turn] += total;
            for (const needed of thresholds)
              if (total >= needed) iconAtLeast[position][turn][needed]++;
          }
        }
        quits[position] += state.forceQuits > 0 ? 1 : 0;
        quitTotals[position] += state.forceQuits;
        for (const tier of mainframe.tiers) {
          const hit = state.reached[tier.tier];
          if (hit !== undefined) {
            const bucket = ramAtTier[position][tier.tier] || (ramAtTier[position][tier.tier] = { installed: [], free: [] });
            bucket.installed.push(state.tierRam[tier.tier].installed);
            bucket.free.push(state.tierRam[tier.tier].free);
            for (let turn = hit; turn <= turns; turn++) {
              const k = `${tier.tier}|${position}|${turn}`;
              hits.set(k, (hits.get(k) || 0) + 1);
            }
          }
        }
        if ((trial + 1) % stride === 0 || trial + 1 === trials) {
          progress({ phase: 'Simulating turn curves', stage: 'main', completed: trial + 1, total: trials, position });
          await yieldFrame();
        }
      }
    }
    // Splash curves from the accumulators, if a package was tracked.
    const splashCurves = [];
    const splashIcons = { first: [], second: [] };
    if (splash) {
      for (const position of ['first', 'second']) {
        for (const card of payoffs)
          for (let turn = 1; turn <= turns; turn++) {
            const reached = reqHits.get(`${card.id}|${position}|${turn}`) || 0;
            const [low, high] = wilson(reached, trials);
            splashCurves.push({ card_id: card.id, name: card.name, persistent: !!card.persistent,
              position, turn, reached_count: reached, trials, probability: reached / trials,
              wilson_95_low: low, wilson_95_high: high });
          }
        for (let turn = 1; turn <= turns; turn++) {
          const atLeast = Object.entries(iconAtLeast[position][turn])
            .map(([needed, count]) => ({ min_icons: Number(needed), probability: count / trials }));
          splashIcons[position].push({ turn, mean_icons: iconTotals[position][turn] / trials, at_least: atLeast });
        }
      }
    }
    // Splash-tax A/B: rerun the same games with the splash package's copies
    // swapped for neutral fillers, isolating what the package costs the
    // Mainframe's own tiers. Only when a package is tracked and neutral
    // filler cards exist in the deck.
    let splashTax = null;
    if (splash) {
      const splashSet = new Set(deck.filter(card => splash.factions.some(f => card.factions.includes(f))));
      const swapPool = deck.filter(card => splashSet.has(card));
      if (swapPool.length) {
        const filler = taxFiller(swapPool);
        const neutralDeck = deck.filter(card => !splashSet.has(card))
          .concat(Array.from({ length: swapPool.length }, () => filler));
        const taxHits = new Map();
        for (const position of ['first', 'second']) {
          for (let trial = 0; trial < trials; trial++) {
            const state = simulate(neutralDeck, mainframe, position === 'first', seed + 1000000 + trial, turns, ramTarget, null);
            for (const tier of mainframe.tiers) {
              const hit = state.reached[tier.tier];
              if (hit !== undefined)
                for (let turn = hit; turn <= turns; turn++) {
                  const k = `${tier.tier}|${position}|${turn}`;
                  taxHits.set(k, (taxHits.get(k) || 0) + 1);
                }
            }
            if ((trial + 1) % stride === 0 || trial + 1 === trials) {
              progress({ phase: 'Simulating splash-tax comparison', stage: 'main', completed: trial + 1, total: trials, position });
              await yieldFrame();
            }
          }
        }
        const taxCurves = [];
        for (const tier of mainframe.tiers) for (const position of ['first', 'second'])
          for (let turn = 1; turn <= turns; turn++) {
            const reached = taxHits.get(`${tier.tier}|${position}|${turn}`) || 0;
            taxCurves.push({ tier: tier.tier, position, turn, probability: reached / trials, trials });
          }
        splashTax = { filler_card: { id: filler.id, name: filler.name, cost: filler.cost }, curves: taxCurves };
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
    // Embed the neutral-swap probabilities on the base curve rows too, so
    // consumers can chart the A/B without joining on (tier, position, turn).
    if (splashTax) for (const row of curves) {
      const match = splashTax.curves.find(r => r.tier === row.tier && r.position === row.position && r.turn === row.turn);
      if (match) row.splash_tax_probability = match.probability;
    }
    const summaries = {};
    for (const tier of mainframe.tiers) summaries[tier.tier] = sourceSummary(deck, tier);
    // Installed/free RAM at the moment each tier first came online, per position.
    const mean = list => list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
    const sd = list => { if (list.length < 2) return 0; const m = mean(list);
      return Math.sqrt(list.reduce((s, v) => s + (v - m) ** 2, 0) / (list.length - 1)); };
    const ramToTier = {};
    const bin = list => { const bins = {};
      for (const value of list) bins[value] = (bins[value] || 0) + 1;
      return bins; };
    for (const position of ['first', 'second']) {
      ramToTier[position] = {};
      for (const tier of mainframe.tiers) {
        const bucket = ramAtTier[position][tier.tier];
        ramToTier[position][tier.tier] = bucket ? {
          n: bucket.installed.length,
          installed_mean: mean(bucket.installed), installed_sd: sd(bucket.installed),
          free_mean: mean(bucket.free), free_sd: sd(bucket.free),
          installed_bins: bin(bucket.installed), free_bins: bin(bucket.free) } : null;
      }
    }
    // Splash variant of the RAM histogram: installed RAM when the first
    // persistent splash payoff came online (only meaningful when tracked).
    const splashRam = splash ? {
      note_n: { first: ramAtSplash.first.length, second: ramAtSplash.second.length },
      installed_bins: { first: bin(ramAtSplash.first), second: bin(ramAtSplash.second) }
    } : null;
    // Card requirement telemetry: cumulative play/online curves AND first-hit
    // turn histograms for EVERY requirement-bearing card in the deck.
    const cardFirstPlay = [];
    for (const card of reqCards) for (const position of ['first', 'second']) {
      const dist = firstHitTurns.get(`${card.id}|${position}`) || { never: 0 };
      const firstTurnCounts = {};
      for (let turn = 1; turn <= turns; turn++) firstTurnCounts[turn] = dist[turn] || 0;
      for (let turn = 1; turn <= turns; turn++) {
        const reached = reqHits.get(`${card.id}|${position}|${turn}`) || 0;
        cardFirstPlay.push({ card_id: card.id, name: card.name, persistent: !!card.persistent,
          factions: card.factions, requirement: card.requirements, cost: card.cost,
          position, turn, reached_count: reached, trials, probability: reached / trials,
          first_turn_counts: firstTurnCounts, never_count: dist.never });
      }
    }
    const warnings = [LIMITS];
    if (splash && !payoffs.length)
      warnings.push('The tracked splash package has no requirement-bearing payoffs; only board icons are shown.');
    if (deck.some(card => card.type === 'PROGRAM' && card.subtype === 'SCRIPT'))
      warnings.push('Scripts are included as draws; their printed effects are not simulated.');
    if (deck.some(card => card.has_ability)) warnings.push('Printed abilities on deck cards are not executed.');
    return { model: 'structural_force_quit_static_web', catalog_sha256: root.NEUROSCAPE_CATALOG?.catalog_sha256,
      mainframe: { id: mainframe.id, name: mainframe.name, tiers: mainframe.tiers },
      deck_size: deck.length, deck_signature: signature, deck_entries: parsed.entries,
      source_summary_by_tier: summaries,
      settings: { trials_per_position: trials, turns, ram_target: ramTarget,
        ram_target_selection: (requestedTarget === null ? 'equal-tier/equal-turn pilot' : 'manual') + (splashFloor ? ' + splash floor' : ''),
        pilot_trials_per_position_per_target: pilotTrials, pilot_scores: pilotScores },
      draw_only: drawOnly, curves,
      card_first_play: cardFirstPlay,
      ram_to_tier: ramToTier,
      splash_ram: splashRam,
      splash: splash ? { factions: splash.factions, payoffs: payoffs.map(card => ({ card_id: card.id, name: card.name,
        persistent: !!card.persistent, requirement: card.requirements })),
      curves: splashCurves, icons: splashIcons, tax: splashTax } : null,
      force_quit: Object.fromEntries(['first', 'second'].map(position => [position,
        { share_trials_with_quit: quits[position] / trials, mean_character_quits: quitTotals[position] / trials }])),
      warnings };
  }

  const api = { parseDecklist, exactDrawCurve, drawReference, simulate, analyze,
    sourceSummary, catalogIndex, choose, wilson, hash32, decklistFromAzuniverse, jsonFromLooseText, AZUNIVERSE_DECK_URL };
  root.NEUROSCAPE_ENGINE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
