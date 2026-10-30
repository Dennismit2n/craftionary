// Craftionary – Fundorte: Erzhöhen und Chancen gegen bekannte Werte aus den 26.3-Daten
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { oreProfiles, featuresFor, veinsFor, heightShare, fmtPct, fmtCount } from '../js/sources.js';

const vs = JSON.parse(readFileSync(new URL('../data/versions.json', import.meta.url), 'utf8'));
const src = JSON.parse(readFileSync(new URL(`../data/sources-${vs.default}.json`, import.meta.url), 'utf8'));
const row = (item, kind, key) => (src.items[item] || []).find((r) => r[0] === kind && r[1] === key);

test('Trapezform summiert sich zu 1 und hat ihre Spitze in der Mitte', () => {
  const f = { shape: 't', lo: -144, hi: 16, pl: 0 };
  let sum = 0;
  for (let y = f.lo; y <= f.hi; y++) sum += heightShare(y, f);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.equal(heightShare(-64, f), 1 / 81);
  assert.equal(heightShare(16, f), 1 / 6561);
});

test('Diamant: beste Höhe Y −59, 80-%-Bereich −60 bis −39, gut ein Drittel an Höhlenwänden sichtbar', () => {
  const [p] = oreProfiles(src, featuresFor(src, 'diamond'));
  assert.equal(p.dim, 'overworld');
  assert.equal(p.best.y, -59);
  assert.deepEqual(p.best.band, [-60, -39]);
  assert.ok(p.visible > 0.29 && p.visible < 0.32, String(p.visible));
});

test('Eisen: Gebirge Y 232, normales Gelände Y 16, Großadern −60 bis −9', () => {
  const [p] = oreProfiles(src, featuresFor(src, 'raw_iron'));
  assert.equal(p.best.y, 232);
  assert.deepEqual(p.best.band, [202, 262]);
  assert.equal(p.low.y, 16);
  assert.deepEqual(p.low.band, [7, 25]);
  const v = veinsFor(src, 'raw_iron');
  assert.equal(v.length, 1);
  assert.equal(v[0].lo, -60);
  assert.equal(v[0].hi, -9);
});

test('Antiker Schrott liegt im Nether und nur in Erz-Biomen des Nethers', () => {
  const [p] = oreProfiles(src, featuresFor(src, 'ancient_debris'));
  assert.equal(p.dim, 'nether');
  assert.ok(p.best.y >= 8 && p.best.y <= 24, String(p.best.y));
  assert.ok(Array.isArray(p.biomes) && p.biomes.includes('nether_wastes'));
});

test('Smaragd nur in Berg-Biomen', () => {
  const [p] = oreProfiles(src, featuresFor(src, 'emerald'));
  assert.ok(Array.isArray(p.biomes) && p.biomes.includes('jagged_peaks') && !p.biomes.includes('plains'));
});

test('Chancen aus den Loot-Tabellen', () => {
  assert.equal(row('flint', 'block', 'gravel')[2], 0.1);
  assert.equal(row('bone', 'mob', 'skeleton')[2], 0.6667);
  assert.equal(row('diamond', 'chest', 'desert_pyramid')[2], 0.0594);
  assert.equal(row('name_tag', 'fish', 'gameplay/fishing')[2], 0.0083);
  assert.match(row('bone', 'mob', 'skeleton')[6], /L/);
  assert.match(row('diamond', 'block', 'diamond_ore')[6], /F/);
});

test('Selbst-Drops sind ausgeblendet, Behutsamkeit-only ist markiert', () => {
  assert.equal(row('dirt', 'block', 'dirt'), undefined);
  assert.match(row('stone', 'block', 'stone')[6], /S/); // normal fällt Bruchstein, nur mit Behutsamkeit Stein
  assert.match(row('diamond_ore', 'block', 'diamond_ore')[6], /S/);
});

test('Handel: Waffenschmied verkauft das Diamantschwert für Smaragde', () => {
  const t = src.trades.diamond_sword.find((x) => x[0] === 'weaponsmith');
  assert.equal(t[1], 5);
  assert.equal(t[2][0][0], 'emerald');
});

test('Formatierung', () => {
  assert.equal(fmtPct(0.0594), '5,9 %');
  assert.equal(fmtPct(0.0083), '0,83 %');
  assert.equal(fmtPct(1), '100 %');
  assert.equal(fmtPct(0.6667, 'en'), '66.7%');
  assert.equal(fmtCount(1, 3), '1–3');
  assert.equal(fmtCount(2, 2), '×2');
});
