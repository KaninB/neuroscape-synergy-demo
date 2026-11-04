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
    hosts[id] = stubElement(id === 'milestoneTurn' || id === 'cardsSeen' || id === 'turns' ? 'input' : 'div');
    if (id === 'milestoneTurn') hosts[id].value = '8';
    if (id === 'cardsSeen') hosts[id].value = '12';
    if (id === 'turns') hosts[id].value = '12';
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
    return {
      milestoneRows: (hosts.milestoneTable.$html.match(/<tr/g) || []).length,
      drawRows: (hosts.drawTable.$html.match(/<tr/g) || []).length,
      chartChildren: ['firstChart','secondChart','factionChart','jointChart'].map(id => hosts[id].children.length),
      sourceSummaryLen: hosts.sourceSummary.$html.length,
      milestonePicked: hosts.milestoneTable.$html.includes('class="picked"'),
      drawPicked: hosts.drawTable.$html.includes('class="picked"'),
      legendLen: hosts.turnLegend.$html.length,
      statsLen: hosts.stats.$html.length
    };
  } };`);

(async () => {
  const api = run(globalThis, hosts);
  const out = await api.analyze();
  console.log(JSON.stringify(out, null, 1));
  const fail = [];
  if (out.milestoneRows < 4) fail.push('milestone rows missing');
  if (out.drawRows < 4) fail.push('draw rows missing');
  if (out.chartChildren.some(n => !n)) fail.push('a chart host is empty');
  if (!out.milestonePicked) fail.push('milestone picker column not highlighted');
  if (!out.drawPicked) fail.push('draw picker column not highlighted');
  if (!out.sourceSummaryLen) fail.push('source summary empty');
  if (fail.length) { console.error('FAIL: ' + fail.join('; ')); process.exit(1); }
  console.log('render harness PASS');
})().catch(e => { console.error('FAIL', e && e.stack || e); process.exit(1); });
