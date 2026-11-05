'use strict';
/* Combo harness: drives the Mainframe combobox (filter + keyboard nav) headlessly. */
const fs = require('fs');
const path = require('path');
const repo = path.resolve(__dirname, '..');

function stubElement(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(), children: [], attrs: {}, style: {}, dataset: {},
    hidden: false, value: '', textContent: '', clientWidth: 900, _listeners: {},
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    removeEventListener() {},
    dispatch(type, event = {}) {
      event.preventDefault = event.preventDefault || (() => {});
      event.stopPropagation = event.stopPropagation || (() => {});
      for (const fn of this._listeners[type] || []) fn(event);
    },
    closest(sel) { return null; },
    querySelector(sel) { return this.children.find(c => sel === '.empty' ? (c.attrs.class || '').includes('empty') : false) || stubElement(); },
    querySelectorAll(sel) {
      if (sel === 'li') return this.children;
      if (sel === '.info-wrap.open') return [];
      return [];
    },
    scrollIntoView() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    append(...kids) { this.children.push(...kids.filter(Boolean)); },
    appendChild(k) { this.children.push(k); return k; },
    replaceChildren() { this.children = []; },
    insertAdjacentHTML(pos, html) { this._html = (this._html || '') + html; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 400 }; },
    get innerHTML() { return this.$html || ''; },
    set innerHTML(v) {
      this.$html = String(v); this.children = [];
      // Parse enough of the option markup for the keyboard logic to walk children.
      const re = /<li\b[^>]*>/g; let m;
      while ((m = re.exec(v))) {
        const li = stubElement('li');
        const empty = m[0].includes('class="empty"');
        if (empty) li.attrs.class = 'empty';
        li.textContent = (v.slice(re.lastIndex).split('</li>')[0].replace(/<[^>]*>/g, '') || '').trim();
        this.children.push(li);
      }
    },
    focus() {}, select() {},
  };
  return el;
}

const hosts = {};
const get = id => hosts[id] || (hosts[id] = stubElement(id === 'mainframe' || id === 'turns' || id === 'milestoneTurn' ? 'input' : 'div'));
get('mainframe').closest = sel => (sel === '.info-wrap' ? null : null);

global.document = {
  getElementById: get,
  createElement: tag => stubElement(tag),
  createElementNS: (ns, tag) => stubElement(tag),
  querySelectorAll: () => [],
  addEventListener() {}, activeElement: null, contains() { return false; }
};
global.window = { addEventListener() {} };
global.addEventListener = () => {};
global.requestAnimationFrame = fn => { fn(); return 0; };
global.fetch = () => Promise.reject(new Error('offline harness'));
global.Blob = class {}; global.URL = URL; global.AbortController = AbortController;

require(path.join(repo, 'catalog.js'));
require(path.join(repo, 'engine.js'));

const code = fs.readFileSync(path.join(repo, 'app.js'), 'utf8');
new Function('globalThis', code)(globalThis);

(async () => {
  const input = get('mainframe'), list = get('mainframeList');
  const catalog = globalThis.NEUROSCAPE_CATALOG;
  const fail = [];
  const names = catalog.cards.filter(c => c.type === 'MAINFRAME').map(c => c.name);
  if (!names.length) { console.error('FAIL: no mainframes in catalog'); process.exit(1); }

  // 1. Focus opens the full list
  input.dispatch('focus');
  if (list.hidden || list.children.length !== names.length) fail.push(`focus should open full list (${list.children.length}/${names.length})`);

  // 2. Typing filters
  input.value = 'gear'; input.dispatch('input');
  const gearCount = list.children.length;
  const gearMatches = names.filter(n => n.toLowerCase().includes('gear')).length;
  if (gearCount !== gearMatches) fail.push(`filter 'gear' expected ${gearMatches}, got ${gearCount}`);

  // 3. ArrowDown + Enter selects the first filtered match
  input.dispatch('keydown', { key: 'ArrowDown' });
  input.dispatch('keydown', { key: 'Enter' });
  const picked = input.value;
  if (!picked.toLowerCase().includes('gear')) fail.push(`ArrowDown+Enter picked "${picked}"`);
  if (!list.hidden) fail.push('Enter should close the list');

  // 4. Escape closes after reopening
  input.dispatch('focus'); input.value = ''; input.dispatch('input');
  if (list.hidden) fail.push('re-focus should reopen');
  input.dispatch('keydown', { key: 'Escape' });
  if (!list.hidden) fail.push('Escape should close');

  // 5. No-match query shows empty row and no selection crash
  input.value = 'zzzz'; input.dispatch('input');
  if (!list.children.length || !(list.children[0].attrs.class || '').includes('empty')) fail.push('no-match should render empty row');
  input.dispatch('keydown', { key: 'ArrowDown' }); // must not throw with 0 usable rows
  input.dispatch('keydown', { key: 'Enter' });

  // 6. choose() echoes into the countbox path (updateDeckCount ran without crash)

  if (fail.length) { console.error('FAIL: ' + fail.join('; ')); process.exit(1); }
  console.log(`combo harness PASS (${names.length} mainframes, 'gear' → ${gearCount})`);
})().catch(e => { console.error('FAIL', e && e.stack || e); process.exit(1); });
