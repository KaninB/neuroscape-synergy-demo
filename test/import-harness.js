'use strict';
/* Import harness: azuniverse JSON → decklist conversion keeps sections separate. */
const fs = require('fs');
const path = require('path');
const repo = path.resolve(__dirname, '..');

require(path.join(repo, 'catalog.js'));
require(path.join(repo, 'engine.js'));
const engine = globalThis.NEUROSCAPE_ENGINE;
const catalog = globalThis.NEUROSCAPE_CATALOG;

const fail = [];
// Fixture mirrors a live azuniverse /api/decks/{id} payload: FIREWALL appears
// in BOTH cyberdeck and sideboard; ram + sideboard items must stay out of #CYBERDECK.
const payload = {
  mainframeCard: { name: 'OMNIS BLOOD DIAMOND' },
  items: [
    { section: 'cyberdeck', quantity: 2, card: { name: 'FIREWALL' } },
    { section: 'cyberdeck', quantity: 4, card: { name: 'BOONYEN, WARDRIVER' } },
    { section: 'cyberdeck', quantity: 3, card: { name: 'METAL HEAD' } },
    { section: 'cyberdeck', quantity: 4, card: { name: 'UNPAID INTERN' } },
    { section: 'cyberdeck', quantity: 4, card: { name: 'TRUSTFUND BABY' } },
    { section: 'cyberdeck', quantity: 4, card: { name: 'SEEKER DRONES' } },
    { section: 'cyberdeck', quantity: 2, card: { name: 'GENERATIONAL WEALTH' } },
    { section: 'cyberdeck', quantity: 2, card: { name: 'ROXY RIOT' } },
    { section: 'cyberdeck', quantity: 3, card: { name: 'JETT THORN' } },
    { section: 'cyberdeck', quantity: 4, card: { name: 'THE SINGULARITY' } },
    { section: 'cyberdeck', quantity: 4, card: { name: 'DÉJÀ VU' } },
    { section: 'cyberdeck', quantity: 3, card: { name: 'TERMINATE' } },
    { section: 'cyberdeck', quantity: 3, card: { name: 'SOLAR FLARE' } },
    { section: 'cyberdeck', quantity: 4, card: { name: 'NEOSEC FIRESTORM' } },
    { section: 'cyberdeck', quantity: 4, card: { name: 'ASTRA, COSMIC KITTY' } },
    { section: 'ram', quantity: 25, card: { name: 'BASIC RAM' } },
    { section: 'sideboard', quantity: 2, card: { name: 'FIREWALL' } },
    { section: 'sideboard', quantity: 3, card: { name: 'GARBAGE DAY' } },
    { section: 'sideboard_mainframe', quantity: 1, card: { name: 'OMNIS BLOOD DIAMOND' } },
  ],
};

const text = engine.decklistFromAzuniverse(payload);
const lines = text.split('\n');
const deckText = text;

const parsed = engine.parseDecklist(text, catalog);

if (!text.startsWith('1 OMNIS BLOOD DIAMOND\n#CYBERDECK\n')) fail.push(`mainframe/#CYBERDECK header missing: ${lines.slice(0, 2).join(' | ')}`);
if (parsed.deckCount !== 50) fail.push(`deckCount ${parsed.deckCount}, want 50 (cyberdeck only)`);
if (parsed.sideboardCount !== 0) fail.push(`sideboardCount ${parsed.sideboardCount}, want 0 (sideboard not imported)`);
if (parsed.ramCount !== 0) fail.push(`ramCount ${parsed.ramCount}, want 0 (converter skips RAM items)`);
if (!deckText.includes('2 FIREWALL')) fail.push('cyberdeck section should contain 2 FIREWALL');
if (deckText.includes('GARBAGE DAY')) fail.push('sideboard card GARBAGE DAY leaked into #CYBERDECK');
if (text.includes('BASIC RAM')) fail.push('ram item leaked into decklist text');
if (parsed.errors.length) fail.push(`parse errors: ${parsed.errors.join('; ')}`);

if (fail.length) { console.error('FAIL: ' + fail.join('; ')); process.exit(1); }
console.log('import harness PASS (deck 50 only / sideboard + ram not imported)');
