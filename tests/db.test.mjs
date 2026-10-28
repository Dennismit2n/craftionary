// Tests für Rezeptlogik: Platzierung wie im Spiel, Mengen, Brennstoff, Materialliste, freies Craften
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DB, placeRecipe } from '../js/db.js';

const db = new DB(JSON.parse(readFileSync(new URL('../data/26.3.json', import.meta.url))));
const R = (id) => db.recipes.find((r) => r.id === id);
const show = (cells) => cells.map((c) => (c == null ? '.' : 'X')).join('');

test('Platzierung wie im Rezeptbuch: schmale Rezepte mittig, breite oben links', () => {
  assert.equal(show(db.layout(R('stick'))), '.X..X....');          // 1×2 → Mitte oben
  assert.equal(show(db.layout(R('torch'))), '.X..X....');
  assert.equal(show(db.layout(R('wooden_sword'))), '.X..X..X.');   // 1×3 → mittlere Spalte
  assert.equal(show(db.layout(R('crafting_table'))), 'XX.XX....'); // 2×2 → oben links
  assert.equal(show(db.layout(R('wooden_pickaxe'))), 'XXX.X..X.');
  assert.equal(show(db.layout(R('white_bed'))), 'XXXXXX...');      // 3×2 → oben
  assert.equal(show(db.layout(R('oak_planks'))), 'X........');     // formlos → oben links
  assert.equal(show(db.layout(R('stick'), 2)), 'XX..'.replace('XX..', 'X.X.')); // 2×2: links
});

test('placeRecipe: einzelne Zeile wird in die Mitte gesetzt', () => {
  assert.deepEqual(placeRecipe(3, 3, 3, 1, ['a', 'b', 'c']), [null, null, null, 'a', 'b', 'c', null, null, null]);
  assert.deepEqual(placeRecipe(3, 3, 1, 1, ['a']), [null, null, null, null, 'a', null, null, null, null]);
});

test('Holzspitzhacke: richtige Zutaten, Herstellung nur an der Werkbank', () => {
  const r = db.recipesFor('wooden_pickaxe')[0];
  assert.equal(r.station, 'crafting');
  assert.equal(r.fits2, false);
  const ing = db.ingredientsOf(r).map((e) => [e.ref, e.count]);
  assert.deepEqual(ing.sort(), [['#wooden_tool_materials', 3], ['stick', 2]].sort());
});

test('Werkbank geht auch im Inventar, Spitzhacke nicht', () => {
  assert.ok(db.byStation.get('inventory').some((r) => r.id === 'crafting_table'));
  assert.ok(!db.byStation.get('inventory').some((r) => r.id === 'wooden_pickaxe'));
});

test('16 Fackeln = 4× craften, je 4 Kohle und 4 Stöcke', () => {
  const p = db.plan(R('torch'), 16);
  assert.equal(p.crafts, 4);
  assert.equal(p.leftover, 0);
  assert.equal(p.perSlot, 4);
  const byRef = Object.fromEntries(p.ingredients.map((e) => [Array.isArray(e.ref) ? e.ref.join('|') : e.ref, e.count]));
  assert.equal(byRef['coal|charcoal'], 4);
  assert.equal(byRef.stick, 4);
});

test('Eisenbarren im Ofen: 10 s pro Stück, 1 Kohle reicht für 8', () => {
  const r = R('iron_ingot_from_smelting_raw_iron');
  assert.equal(r.time, 200);
  const f = db.fuelFor(r, 'coal', 8);
  assert.equal(f.perFuel, 8);
  assert.equal(f.count, 1);
  const blast = R('iron_ingot_from_blasting_raw_iron');
  assert.equal(blast.time, 100);
  assert.equal(db.fuelFor(blast, 'coal', 8).perFuel, 8); // halbe Brenndauer, doppeltes Tempo
});

test('Materialliste Holzspitzhacke: 2 Stämme, Reste 3 Bretter + 2 Stöcke', () => {
  const b = db.breakdown('wooden_pickaxe', 1);
  assert.deepEqual(b.raw.map((e) => [e.ref, e.count]), [['#oak_logs', 2]]);
  const left = Object.fromEntries(b.leftovers.map((e) => [e.id, e.count]));
  assert.equal(left.oak_planks, 3);
  assert.equal(left.stick, 2);
});

test('Materialliste: Eisenbarren bleibt Grundstoff, Speicherblock wird nicht zurückverwandelt', () => {
  const b = db.breakdown('iron_pickaxe', 1);
  const raw = Object.fromEntries(b.raw.map((e) => [Array.isArray(e.ref) ? e.ref.join('|') : e.ref, e.count]));
  assert.equal(raw.iron_ingot, 3);
  assert.equal(raw['#oak_logs'], 1);
});

test('Freies Craften erkennt Holzspitzhacke, auch verschoben und gespiegelt', () => {
  const P = 'spruce_planks', S = 'stick';
  const hits = db.matchCrafting([P, P, P, null, S, null, null, S, null], 3);
  assert.ok(hits.some((r) => r.out.id === 'wooden_pickaxe'));
  // Treppe gespiegelt
  const C = 'cobblestone';
  const stairs = db.matchCrafting([null, null, C, null, C, C, C, C, C], 3);
  assert.ok(stairs.some((r) => r.out.id === 'cobblestone_stairs'));
  // Werkbank 2×2 unten rechts im 3×3
  const table = db.matchCrafting([null, null, null, null, P, P, null, P, P], 3);
  assert.ok(table.some((r) => r.out.id === 'crafting_table'));
  // formlos: Bretter aus einem Stamm, egal wo
  const planks = db.matchCrafting([null, null, null, null, null, null, null, null, 'birch_log'], 3);
  assert.ok(planks.some((r) => r.out.id === 'birch_planks'));
});

test('Freies Craften: Shulker-Kiste färben und Feuerwerksrakete', () => {
  const dyed = db.matchCrafting(['shulker_box', 'red_dye', null, null, null, null, null, null, null], 3);
  assert.ok(dyed.some((r) => r.out.id === 'red_shulker_box'));
  const rocket = db.matchCrafting(['paper', 'gunpowder', 'gunpowder', null, null, null, null, null, null], 3);
  assert.ok(rocket.some((r) => r.out.id === 'firework_rocket'));
});

test('Brauen: Nachtsicht aus Seltsamem Trank + goldener Karotte', () => {
  const rs = db.matchBrewing('potion.awkward', 'golden_carrot');
  assert.equal(rs.length, 1);
  assert.equal(rs[0].out.id, 'potion.night_vision');
  const info = db.potionInfo('potion.long_night_vision');
  assert.equal(info.effects[0].ticks, 9600);
  const lin = db.potionInfo('lingering_potion.night_vision');
  assert.equal(lin.effects[0].ticks, 900); // 3600 × 0,25
});

test('Verwendung: Stock steckt in Fackel und Holzspitzhacke', () => {
  const uses = db.usagesOf('stick').map((u) => u.r.out && u.r.out.id);
  assert.ok(uses.includes('torch'));
  assert.ok(uses.includes('wooden_pickaxe'));
});

test('Jedes Rezept hat eine Station und gültige Zutaten', () => {
  for (const r of db.recipes) {
    assert.ok(r.station, `ohne Station: ${r.id}`);
    for (const [ref] of db.roles(r)) {
      assert.ok(db.ingItems(ref).length > 0, `leere Zutat in ${r.id}: ${ref}`);
      for (const id of db.ingItems(ref)) assert.ok(db.items[id], `unbekanntes Item ${id} in ${r.id}`);
    }
    if (r.out) assert.ok(db.items[r.out.id], `unbekanntes Ergebnis in ${r.id}`);
  }
});
