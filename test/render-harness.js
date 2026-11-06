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
    append(...kids) { for (const k of kids) this.children.push(k); },
    appendChild(k) { this.append(k); return k; },
    replaceChildren(...kids) { this.children = kids; },
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
  createTextNode: text => ({ $text: String(text) }),
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
const appHasEmoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{2603}\u{265F}\u{2699}\u{2692}\u{2B50}\u{2728}\u{270A}]/u.test(code);
if (code.includes('FACTION_GLYPH') || appHasEmoji) { console.error('FAIL: app.js still carries faction emoji glyphs'); process.exit(1); }
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
    render(splashResult); // second pass to catch state pollution
    // requirement table + splash variants render on the splash pass
    return {
      verdictCards: (hosts.verdict.$html.match(/class="card"/g) || []).length,
      compositionLen: hosts.composition.$html.length,
      sourceLineCount: (hosts.sourceLines.$html.match(/src-line/g) || []).length,
      curveChildren: hosts.curveChart.children.length,
      chipCount: (hosts.milestoneChips.$html.match(/class="chip"/g) || []).length,
      chipHasCI: hosts.milestoneChips.$html.includes('class="ci"'),
      handLineCount: (hosts.handLines.children || []).filter(k => k.className === 'hand-line').length,
      handText: (function walk(k){ let out=[]; if(k&&k.$text!==undefined)out.push(String(k.$text)); for(const c of (k&&k.children||[])) out=out.concat(walk(c)); return out; })(hosts.handLines).join(' '),
      ramTierButtons: (hosts.ramTierToggle.children || []).map(k => k.attrs['data-tier']).join(','),
      ramNoteLen: ((hosts.ramNote.$html || hosts.ramNote.textContent) || '').length,
      ramChildren: hosts.ramChart.children.length,
      quitLen: (hosts.quitLine.textContent || hosts.quitLine.$html || '').length,
      warningsLen: hosts.warnings.$html.length,
      splashChildren: hosts.splashChart.children.length,
      // prose is built with DOM text nodes now — recurse for text
      splashProse: (function walk(k){ let out=[]; if(k&&k.$text!==undefined)out.push(String(k.$text)); for(const c of (k&&k.children||[])) out=out.concat(walk(c)); return out; })(hosts.splashCardProse).join(' '),
      splashHistNote: hosts.splashHistNote.textContent || '',
      deckCostChildren: hosts.deckCostChart.children.length,
      deckCostNote: hosts.deckCostNote.textContent || '',
      splashTaxCount: (hosts.splashTaxChips.children || []).filter(k => k.className === 'chip').length,
      splashTitleLen: (hosts.splashTitle.textContent || hosts.splashTitle.$html || '').length,
      splashLinesLen: (hosts.splashLines.$html || '').length,
      splashTaxText: (hosts.splashTaxChips.children || []).map(k => JSON.stringify(k.children)).join(' '),
      reqTableRows: ((hosts.reqTable.$html || '').match(/<tr>/g) || []).length,
      reqTableHint: (hosts.reqTable.$html || '').includes('Scripts are PLAYED'),
      compositionSplash: (hosts.composition.$html || '').includes('Splash ('),
      handSplash: (function walk(k){ let o=[]; if(k&&k.$text!==undefined)o.push(String(k.$text)); for(const c of (k&&k.children||[])) o=o.concat(walk(c)); return o; })(hosts.handLines).join(' ').includes('Splash ('),
      splashLineNames: (hosts.splashLines.$html || '').includes('THE SPIRIT REALM')
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
  if (/±/.test(out.handText)) fail.push('hand lines still show mean ± SD clause');
  if (!out.ramTierButtons) fail.push('ram tier buttons missing');
  if (!out.ramTierButtons.split(',').includes('1') || !out.ramTierButtons.split(',').includes('2')) fail.push('ram tier 1/2 buttons missing');
  if (!out.ramTierButtons.split(',').includes('splash')) fail.push('ram splash button missing');
  if (!out.ramNoteLen) fail.push('ram note missing');
  if (!out.ramChildren) fail.push('ram chart empty');
  if (!out.quitLen) fail.push('quit line missing');
  if (!out.warningsLen) fail.push('warnings missing');
  if (!out.splashChildren) fail.push('splash chart empty');
  if (out.splashChildren) {
    // threshold-lines chart: one svg, a path per requirement level
    const paths = (out.splashChartPaths = (hosts.splashChart.children[0] && hosts.splashChart.children[0].children || [])
      .filter(k => String(k.tagName).toLowerCase() === 'path').length);
    if (paths < 1) fail.push('splash threshold lines missing');
  }
  if (!/requirements come online/.test(out.splashProse) || /Payoffs/.test(out.splashProse)) fail.push('splash prose wrong (payoffs list should be gone)');
  if (!out.splashHistNote.includes('at least')) fail.push('splash threshold note missing');
  if (!out.deckCostChildren) fail.push('deck cost chart empty');
  if (!out.deckCostNote.includes('RAM cost')) fail.push('deck cost note missing');
  if (out.splashTaxCount < 1) fail.push('splash tax chips missing');
  if (!out.splashTitleLen) fail.push('splash title missing');
  if (!out.splashLinesLen) fail.push('splash lines missing');
  if (out.splashLineNames) fail.push('splash lines still list every payoff by name');
  if (/NaN/.test(out.splashTaxText)) fail.push('splash tax shows NaN');
  if (!out.splashTaxText.includes('pts')) fail.push('splash tax chip missing pts value');
  if (out.reqTableRows < 3) fail.push('requirement table rows missing');
  if (!out.reqTableHint) fail.push('requirement table hint missing');
  if (!out.compositionSplash) fail.push('composition splash paragraph missing');
  if (!out.handSplash) fail.push('opening-hand splash line missing');
  if (fail.length) { console.error('FAIL: ' + fail.join('; ')); process.exit(1); }
  console.log('render harness PASS');
})().catch(e => { console.error('FAIL', e && e.stack || e); process.exit(1); });
