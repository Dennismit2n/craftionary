// Tests für die fehlertolerante Suche – echte Tippfehler, Deutsch & Englisch
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildIndex, buildAliases, search, parseQuery, normalize, stem, editDistance, substringDistance } from '../js/search.js';

const data = JSON.parse(readFileSync(new URL('../data/26.3.json', import.meta.url)));
const index = buildIndex(data.items, { aliases: buildAliases(data) });

function top(q, n = 1, lang = 'de') {
  return search(index, q, { lang }).results.slice(0, n).map((r) => r.id);
}

// [Suche, erwartete ID (oder Prüf-Funktion), in den ersten N Treffern, Sprache]
const CASES = [
  // Deutsch – exakt und mit Tippfehlern
  ['Holzspitzhacke', 'wooden_pickaxe', 1],
  ['holzspitzhake', 'wooden_pickaxe', 1],
  ['Holz Spitzhacke', 'wooden_pickaxe', 1],
  ['spitzhacke holz', 'wooden_pickaxe', 3],
  ['Eisenschwerd', 'iron_sword', 1],
  ['diamand spitzhacke', 'diamond_pickaxe', 1],
  ['Werkbank', 'crafting_table', 1],
  ['werkbnak', 'crafting_table', 1],
  ['Ofen', 'furnace', 1],
  ['Schmelzofen', 'blast_furnace', 1],
  ['raucherofen', 'smoker', 1],
  ['räucherofen', 'smoker', 1],
  ['Fackel', 'torch', 1],
  ['16 Fackeln', 'torch', 1],
  ['Stöcke', 'stick', 1],
  ['stock', 'stick', 1],
  ['Truhe', 'chest', 1],
  ['Kiste', 'chest', 3],
  ['Eichenholzbretter', 'oak_planks', 1],
  ['eichenbretter', 'oak_planks', 1],
  ['Eisenbarren', 'iron_ingot', 1],
  ['eisen barren', 'iron_ingot', 1],
  ['goldbaren', 'gold_ingot', 1],
  ['Diamantblock', 'diamond_block', 1],
  ['Redstone', 'redstone', 3],
  ['Bett', (id) => id.endsWith('_bed'), 1],
  ['weisses bett', 'white_bed', 1],
  ['weises bett', 'white_bed', 1],
  ['Trank der Nachtsicht', (id) => id.startsWith('potion.') && id.endsWith('night_vision'), 1],
  ['nachtsichttrank', (id) => id.startsWith('potion.') && id.endsWith('night_vision'), 1],
  ['Heiltrank', (id) => id.startsWith('potion.') && id.endsWith('healing'), 1],
  ['Wurftrank der Heilung', (id) => id.startsWith('splash_potion.') && id.endsWith('healing'), 1],
  ['Giftpfeil', (id) => id.startsWith('tipped_arrow.') && id.endsWith('poison'), 1],
  ['Netherit Schwert', 'netherite_sword', 1],
  ['Netheritschwert', 'netherite_sword', 1],
  ['Netheritaufwertung', 'netherite_upgrade_smithing_template', 1],
  ['Kompass', 'compass', 1],
  ['Bücherregal', 'bookshelf', 1],
  ['Buecherregal', 'bookshelf', 1],
  ['Zaubertisch', 'enchanting_table', 1],
  ['Verzauberungstisch', 'enchanting_table', 1],
  ['Leuchtfeuer', 'beacon', 1],
  ['Amboss', 'anvil', 1],
  ['Kessel', 'cauldron', 1],
  ['TNT', 'tnt', 1],
  ['Rakete', 'firework_rocket', 3],
  ['Seltsame Suppe', 'suspicious_stew', 1],
  ['Lagerfeuer', 'campfire', 1],
  ['Glasflasche', 'glass_bottle', 1],
  ['Wasserflasche', 'potion.water', 1],
  ['Shulkerbox', 'shulker_box', 1],
  ['Endertruhe', 'ender_chest', 1],
  ['Holzaxt', 'wooden_axe', 1],
  ['Äxte', (id) => id.endsWith('_axe'), 1],
  ['Notenblock', 'note_block', 1],
  ['Plattenspieler', 'jukebox', 1],
  ['Kolben', 'piston', 1],
  ['klebriger kolben', 'sticky_piston', 1],
  ['Trichter', 'hopper', 1],
  ['Brot', 'bread', 1],
  ['Kuchen', 'cake', 1],
  ['Leiter', 'ladder', 1],
  ['Schild', 'shield', 2],
  ['Goldapfel', 'golden_apple', 1],
  ['Elytren', 'elytra', 1],
  ['Feuerwerksrakete', 'firework_rocket', 1],
  ['Eisenhelm', 'iron_helmet', 1],
  ['eisenhlem', 'iron_helmet', 1],
  ['Glas', 'glass', 1],
  ['Steinziegel', 'stone_bricks', 1],
  ['Baumpilz', 'shelf_mushroom', 1],
  ['Pappelholzbretter', 'poplar_planks', 1],
  // Englisch
  ['wooden pickaxe', 'wooden_pickaxe', 1, 'en'],
  ['wodden pickaxe', 'wooden_pickaxe', 1, 'en'],
  ['pickaxe', (id) => id.endsWith('_pickaxe'), 1, 'en'],
  ['crafting table', 'crafting_table', 1, 'en'],
  ['crafting tabel', 'crafting_table', 1, 'en'],
  ['furnace', 'furnace', 1, 'en'],
  ['torches', 'torch', 1, 'en'],
  ['16 torches', 'torch', 1, 'en'],
  ['iron ingot', 'iron_ingot', 1, 'en'],
  ['diamond sword', 'diamond_sword', 1, 'en'],
  ['dimond sword', 'diamond_sword', 1, 'en'],
  ['netherite upgrade', 'netherite_upgrade_smithing_template', 1, 'en'],
  ['potion of healing', (id) => id.startsWith('potion.') && id.endsWith('healing'), 1, 'en'],
  ['healing potion', (id) => id.startsWith('potion.') && id.endsWith('healing'), 1, 'en'],
  ['splash potion of strength', (id) => id.startsWith('splash_potion.') && id.endsWith('strength'), 1, 'en'],
  ['ender chest', 'ender_chest', 1, 'en'],
  ['enderchest', 'ender_chest', 1, 'en'],
  ['shulker box', 'shulker_box', 1, 'en'],
  ['bed', (id) => id.endsWith('_bed'), 1, 'en'],
  ['oak planks', 'oak_planks', 1, 'en'],
  ['planks', (id) => id.endsWith('_planks'), 1, 'en'],
  ['sticky piston', 'sticky_piston', 1, 'en'],
  ['enchanting tabel', 'enchanting_table', 1, 'en'],
  ['poison arrow', (id) => id.startsWith('tipped_arrow.') && id.endsWith('poison'), 1, 'en'],
  // Englisch suchen, obwohl die Oberfläche auf Deutsch steht (und umgekehrt)
  ['crafting table', 'crafting_table', 1, 'de'],
  ['Werkbank', 'crafting_table', 1, 'en'],
];

for (const [q, expected, n, lang = 'de'] of CASES) {
  test(`„${q}“ (${lang}) → ${typeof expected === 'string' ? expected : 'passendes Item'} in Top ${n}`, () => {
    const ids = top(q, n, lang);
    const ok = typeof expected === 'function' ? ids.some(expected) : ids.includes(expected);
    assert.ok(ok, `bekommen: ${top(q, 5, lang).join(', ')}`);
  });
}

test('Menge wird erkannt', () => {
  assert.deepEqual(parseQuery('16 Fackeln'), { text: 'fackeln', qty: 16 });
  assert.deepEqual(parseQuery('16x Fackel'), { text: 'fackel', qty: 16 });
  assert.deepEqual(parseQuery('Fackeln x16'), { text: 'fackeln', qty: 16 });
  assert.deepEqual(parseQuery('fackeln 16x'), { text: 'fackeln', qty: 16 });
  assert.deepEqual(parseQuery('64 stück stöcke'), { text: 'stoecke', qty: 64 });
  // Zahl am Ende ohne x bleibt Teil des Namens (z. B. Schallplatte 13)
  assert.deepEqual(parseQuery('Schallplatte 13'), { text: 'schallplatte 13', qty: null });
});

test('Normalisierung & Stamm', () => {
  assert.equal(normalize('Weißes Bett'), 'weisses bett');
  assert.equal(normalize('Räucher-Ofen'), 'raeucher ofen');
  assert.equal(stem('stoecke'), 'stock');
  assert.equal(stem('aexte'), 'axt');
  assert.equal(stem('schwerter'), 'schwert');
  assert.equal(stem('torches'), 'torch');
});

test('Distanzen', () => {
  assert.equal(editDistance('werkbank', 'werkbnak'), 1);
  assert.equal(editDistance('diamant', 'diamand'), 1);
  assert.equal(substringDistance('spitzhake', 'holzspitzhacke'), 1);
});

test('Schallplatte 13 findet die richtige Platte', () => {
  assert.equal(top('Schallplatte 13')[0], 'music_disc_13');
});

test('Suche bleibt schnell (< 60 ms im Schnitt)', () => {
  const qs = ['holzspitzhake', 'eichenbretter', 'nachtsichttrank', 'dimond sword', 'werkbnak', 'raucherofen'];
  const t0 = performance.now();
  for (let k = 0; k < 5; k++) for (const q of qs) search(index, q);
  const avg = (performance.now() - t0) / (5 * qs.length);
  assert.ok(avg < 60, `Durchschnitt ${avg.toFixed(1)} ms`);
});
