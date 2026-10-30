// Craftionary – Muster: Banner, Schild, Verzierter Krug
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_LAYERS, isBannerPage, isPotPage, bannerColor, patternName, bannerCommand, shieldCommand, potCommand, tooLongForChat, loomSteps, draftFor, potFor } from '../js/patterns.js';

const vs = JSON.parse(readFileSync(new URL('../data/versions.json', import.meta.url), 'utf8'));
const data = JSON.parse(readFileSync(new URL(`../data/${vs.default}.json`, import.meta.url), 'utf8'));
const pat = JSON.parse(readFileSync(new URL(`../data/patterns-${vs.default}.json`, import.meta.url), 'utf8'));

test('Daten: 42 Webstuhl-Muster, 10 davon mit Vorlage, 23 Scherben, alle Items bekannt', () => {
  assert.equal(pat.banner.length, 42);
  assert.equal(pat.banner.filter((b) => b.item).length, 10);
  assert.equal(pat.sherds.length, 23);
  assert.deepEqual(pat.colors, Object.keys(data.dyeColors));
  for (const b of pat.banner) {
    if (b.item) assert.ok(data.items[b.item], b.item);
    assert.equal(b.n[0].length, 16);
    assert.equal(b.n[1].length, 16);
  }
  for (const s of pat.sherds) assert.ok(data.items[s], s);
  for (const c of pat.colors) assert.ok(data.items[`${c}_dye`] && data.items[`${c}_banner`], c);
});

test('Vorlagen-Zuordnung: Ziegelfeld und Spickelbord heißen intern anders', () => {
  const item = (id) => pat.banner.find((b) => b.id === id)?.item;
  assert.equal(item('creeper'), 'creeper_banner_pattern');
  assert.equal(item('bricks'), 'field_masoned_banner_pattern');
  assert.equal(item('curly_border'), 'bordure_indented_banner_pattern');
  assert.equal(item('stripe_center'), undefined);
});

test('Namen je Farbe aus den Sprachdateien', () => {
  assert.equal(patternName(pat, 'creeper', 'black', 'en'), 'Black Creeper Charge');
  assert.equal(patternName(pat, 'creeper', 'white', 'de'), 'Weißer Creeper');
});

test('Seiten mit Werkstatt', () => {
  for (const id of ['white_banner', 'red_banner', 'shield', 'loom', 'creeper_banner_pattern']) assert.ok(isBannerPage(pat, id), id);
  for (const id of ['torch', 'white_wool', 'decorated_pot']) assert.ok(!isBannerPage(pat, id), id);
  for (const id of ['decorated_pot', 'angler_pottery_sherd']) assert.ok(isPotPage(pat, id), id);
  assert.ok(!isPotPage(pat, 'brick'));
  assert.equal(bannerColor(pat, 'light_blue_banner'), 'light_blue');
  assert.equal(bannerColor(pat, 'banner'), null);
});

test('Befehle für Banner und Schild', () => {
  const layers = [{ p: 'creeper', c: 'black' }, { p: 'border', c: 'red' }];
  assert.equal(bannerCommand('lime', []), '/give @s lime_banner');
  assert.equal(bannerCommand('lime', layers), '/give @s lime_banner[banner_patterns=[{pattern:"creeper",color:"black"},{pattern:"border",color:"red"}]]');
  assert.equal(shieldCommand('lime', []), '/give @s shield[base_color="lime"]');
  assert.equal(shieldCommand('lime', layers), '/give @s shield[base_color="lime",banner_patterns=[{pattern:"creeper",color:"black"},{pattern:"border",color:"red"}]]');
});

test('Sechs lange Muster sprengen das Chat-Limit, drei passen', () => {
  const six = Array.from({ length: MAX_LAYERS }, () => ({ p: 'diagonal_up_right', c: 'light_gray' }));
  assert.ok(tooLongForChat(shieldCommand('light_gray', six)));
  assert.ok(!tooLongForChat(shieldCommand('light_gray', six.slice(0, 3))));
});

test('Krug: Reihenfolge hinten, links, rechts, vorne; nur Ziegel = schlichter Krug', () => {
  assert.equal(potCommand({ back: 'brick', left: 'brick', right: 'brick', front: 'brick' }), '/give @s decorated_pot');
  assert.equal(potCommand({ back: 'skull_pottery_sherd', left: 'brick', right: 'brick', front: 'heart_pottery_sherd' }),
    '/give @s decorated_pot[pot_decorations=["skull_pottery_sherd","brick","brick","heart_pottery_sherd"]]');
});

test('Webstuhl-Schritte: Banner herstellen, dann je Muster Farbstoff und ggf. Vorlage', () => {
  const s = loomSteps(pat, 'blue', [{ p: 'stripe_center', c: 'white' }, { p: 'flower', c: 'yellow' }]);
  assert.deepEqual(s, [
    { kind: 'craft', item: 'blue_banner' },
    { kind: 'loom', dye: 'white_dye', item: null, p: 'stripe_center', c: 'white' },
    { kind: 'loom', dye: 'yellow_dye', item: 'flower_banner_pattern', p: 'flower', c: 'yellow' },
  ]);
});

test('Entwurf je Seite: Bannerfarbe, Vorlage vorbelegt, Kaputtes aus dem Speicher fällt raus', () => {
  assert.equal(draftFor(pat, 'red_banner', null).base, 'red');
  assert.deepEqual(draftFor(pat, 'globe_banner_pattern', null).layers, [{ p: 'globe', c: 'black' }]);
  const kept = draftFor(pat, 'shield', { base: 'cyan', layers: [{ p: 'creeper', c: 'black' }, { p: 'gibt_es_nicht', c: 'red' }] });
  assert.deepEqual(kept, { base: 'cyan', layers: [{ p: 'creeper', c: 'black' }] });
  assert.equal(potFor(pat, 'angler_pottery_sherd', null).front, 'angler_pottery_sherd');
  assert.deepEqual(potFor(pat, 'decorated_pot', { back: 'quatsch', left: 'brick', right: 'skull_pottery_sherd', front: 'brick' }),
    { back: 'brick', left: 'brick', right: 'skull_pottery_sherd', front: 'brick' });
});
