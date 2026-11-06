'use strict';
/* Headless render harness: executes render() on a stub DOM and validates output. */
const fs = require('fs');
const path = require('path');
const repo = path.resolve(__dirname, '..');

function stubElement(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(), children: [], attrs: {}, style: {}, dataset: {},
    hidden: false, value: '8', textContent: '', clientWidth: 900,
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    append(...kids) { for (const k of kids) { if (k && k.$text) k.$text += String(k); else this.children.push(k); } },
    appendChild(k) { this.append(k); return k; },
    replaceChildren() { this.children = []; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener() {}, removeEventListener() {},
    closest() { return null; }, querySelector() { return stubElement(); }, querySelectorAll() { return []; },
    scrollIntoView() {},
    insertAdjacentHTML(pos, html) { this._html = (this._html || '') + html; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 400 }; },
    get innerHTML() { return this.$html || ''; },
    set innerHTML(v) { this.$html = String(v); this.children = []; },
  };
  if (tag === 'svg') el.attrs.viewBox = '';
  return el;
}

const hosts = {};
function get(id) {
  if (!hosts[id]) {
    hosts[id] = stubElement(id === 'milestoneTurn' || id === 'cardsSeen' || id === 'turns' || id === 'mainframe' ? 'input' : 'div');
    if (id === 'milestoneTurn') hosts[id].value = '8';
    if (id === 'cardsSeen') hosts[id].value = '12';
    if (id === 'turns') hosts[id].value = '6';
  }
  return hosts[id];
}

global.document = {
  getElementById: get,
  createElement: tag => stubElement(tag),
  createElementNS: (ns, tag) => stubElement(tag),
  querySelectorAll: () => [],
  addEventListener() {}, activeElement: null, contains() { return false; }
};
global.window = { addEventListener() {} };
global.addEventListener = () => {};
global.clearTimeout = clearTimeout; global.setTimeout = setTimeout;
global.requestAnimationFrame = fn => { fn(); return 0; };
global.fetch = () => Promise.reject(new Error('offline harness'));
global.URL = URL; global.Blob = class {}; global.AbortController = AbortController;
global.__stubSVGText = true;

let code = fs.readFileSync(path.join(repo, 'app.js'), 'utf8');
// Load real catalog + engine (they attach to globalThis when required)
require(path.join(repo, 'catalog.js'));
require(path.join(repo, 'engine.js'));

// minimal svgNode path uses document.createElementNS — already stubbed.
const run = new Function('globalThis', 'hosts', code + `
  ;return { analyze: async () => {
    // exercise render() with a real engine result
    const engine = globalThis.NEUROSCAPE_ENGINE, catalog = globalThis.NEUROSCAPE_CATALOG;
    if (!engine || !catalog) throw new Error('engine/catalog not loaded');
    const mf = catalog.cards.find(c => c.type === 'MAINFRAME' && c.name === catalog.example_mainframe);
    const parsed = engine.parseDecklist(catalog.example_decklist, catalog);
    const result = await engine.analyze(parsed, mf, { trials: 800, turns: 12 }, p => {});
    render(result);
    render(result); // second pass to catch state pollution
    // splash pass: NEXUS + a MYSTIC package with real payoffs
    const nexus = catalog.cards.find(c => c.type === 'MAINFRAME' && c.name === 'NEXUS');
    const pkg = ['THE SPIRIT REALM', 'ZEN GARDEN', 'THIRD EYE', 'PSYCHIC', 'SEER'].map(name => {
      const card = catalog.cards.find(c => c.name === name);
      return { card_id: card.id, name, copies: 3 };
    });
    const entries = parsed.entries.concat(pkg);
    const deck = entries.flatMap(row => Array(row.copies).fill(catalog.cards.find(c => c.id === row.card_id)));
    const splashParsed = { ...parsed, entries, deck, deckCount: entries.reduce((sum, row) => sum + row.copies, 0) };
    const splashResult = await engine.analyze(splashParsed, nexus, { trials: 600, turns: 10, splash_factions: ['MYSTIC'] }, p => {});
    if (!splashResult.splash || !splashResult.splash.tax) throw new Error('splash telemetry missing');
    render(splashResult);
    return {
      verdictCards: (hosts.verdict.$html.match(/class="card"/g) || []).length,
      compositionLen: hosts.composition.$html.length,
      sourceLineCount: (hosts.sourceLines.$html.match(/src-line/g) || []).length,
      curveChildren: hosts.curveChart.children.length,
      chipCount: (hosts.milestoneChips.$html.match(/class="chip"/g) || []).length,
      chipHasCI: hosts.milestoneChips.$html.includes('class="ci"'),
      handLineCount: (hosts.handLines.$html.match(/hand-line/g) || []).length,
      ramNoteLen: ((hosts.ramNote.$html || hosts.ramNote.textContent) || '').length,
      ramChildren: hosts.ramChart.children.length,
      quitLen: (hosts.quitLine.textContent || hosts.quitLine.$html || '').length,
      warningsLen: hosts.warnings.$html.length,
      splashChildren: hosts.splashChart.children.length,
      splashChipCount: (hosts.splashChips.$html.match(/class="chip"/g) || []).length,
      splashTaxCount: (hosts.splashTaxChips.$html.match(/class="chip"/g) || []).length,
      splashTitleLen: (hosts.splashTitle.textContent || hosts.splashTitle.$html || '').length,
      splashLinesLen: (hosts.splashLines.$html || '').length
    };
  } };`);

(async () => {
  const api = run(globalThis, hosts);
  const out = await api.analyze();
  console.log(JSON.stringify(out, null, 1));
  const fail = [];
  if (out.verdictCards < 1) fail.push('verdict strip empty');
  if (!out.compositionLen) fail.push('composition empty');
  if (out.sourceLineCount < 1) fail.push('source lines missing');
  if (!out.curveChildren) fail.push('curve chart empty');
  if (out.chipCount < 2) fail.push('milestone chips missing');
  if (!out.chipHasCI) fail.push('chip CI missing');
  if (out.handLineCount < 1) fail.push('hand lines missing');
  if (!out.ramNoteLen) fail.push('ram note missing');
  if (!out.ramChildren) fail.push('ram chart empty');
  if (!out.quitLen) fail.push('quit line missing');
  if (!out.warningsLen) fail.push('warnings missing');
  if (!out.splashChildren) fail.push('splash chart empty');
  if (out.splashChipCount < 3) fail.push('splash chips missing');
  if (out.splashTaxCount < 1) fail.push('splash tax chips missing');
  if (!out.splashTitleLen) fail.push('splash title missing');
  if (!out.splashLinesLen) fail.push('splash lines missing');
  if (fail.length) { console.error('FAIL: ' + fail.join('; ')); process.exit(1); }
  console.log('render harness PASS');
})().catch(e => { console.error('FAIL', e && e.stack || e); process.exit(1); });
