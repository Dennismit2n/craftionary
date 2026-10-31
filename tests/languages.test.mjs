// Craftionary – 14 Sprachen: Oberflächentexte vollständig und sauber, Namenspakete passend zu den Daten, Suche in jeder Sprache

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { T, t, setLang, LANGS, BOOT, addTexts, locale } from '../js/i18n.js';
import { setPack, loc } from '../js/loc.js';
import { DB } from '../js/db.js';
import { buildIndex, buildAliases, search, normalize, parseQuery } from '../js/search.js';
import { fmtPct } from '../js/sources.js';

const ROOT = new URL('../', import.meta.url);
const json = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));
const version = json('data/versions.json').default;
const data = json(`data/${version}.json`);
const PACKS = LANGS.map(([c]) => c).filter((c) => c !== 'de' && c !== 'en');
const ui = Object.fromEntries(PACKS.map((c) => [c, json(`i18n/${c}.json`)]));
const pack = (c) => json(`data/lang-${version}/${c}.json`);

const PLURAL_FORMS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
const isPlural = (v) => v && typeof v === 'object' && !Array.isArray(v) && 'other' in v && Object.keys(v).every((k) => PLURAL_FORMS.has(k));
const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) && !isPlural(v) ? flat(v, p + k + '.') : [[p + k, v]]));
const texts = (v) => (isPlural(v) ? Object.values(v) : Array.isArray(v) ? v : [v]);
const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('Sprachliste: 14 Sprachen, jede mit Paketdatei und Ladezeile', () => {
  assert.equal(LANGS.length, 14);
  assert.equal(new Set(LANGS.map(([c]) => c)).size, 14);
  assert.deepEqual(readdirSync(new URL('i18n/', ROOT)).map((f) => f.replace('.json', '')).sort(), [...PACKS].sort());
  for (const c of PACKS) assert.deepEqual(BOOT[c], [ui[c].loading, ui[c].loadFailed], `${c}: BOOT passt nicht zu i18n/${c}.json`);
});

test('Oberflächentexte: gleiche Schlüssel und Platzhalter wie Deutsch, alle Mehrzahlformen', () => {
  const de = Object.fromEntries(flat(T.de));
  const en = Object.fromEntries(flat(T.en));
  assert.deepEqual(Object.keys(de).sort(), Object.keys(en).sort(), 'de und en haben verschiedene Schlüssel');
  for (const c of PACKS) {
    const got = Object.fromEntries(flat(ui[c]));
    assert.deepEqual(Object.keys(got).sort(), Object.keys(de).sort(), `${c}: Schlüssel weichen ab`);
    const forms = new Intl.PluralRules(locale(c)).resolvedOptions().pluralCategories.filter((f) => f !== 'many' || c === 'pl' || c === 'ru');
    for (const [k, v] of Object.entries(got)) {
      if (k === 'examples') { assert.equal(v.length, 6, `${c}: examples`); continue; }
      const want = holes(texts(en[k])[0]);
      for (const s of texts(v)) assert.equal(holes(s), want, `${c}.${k}: Platzhalter`);
      if (isPlural(en[k])) for (const f of forms) assert.ok(typeof v[f] === 'string', `${c}.${k}: Mehrzahlform ${f} fehlt`);
    }
  }
});

test('Oberflächentexte: keine Gedankenstriche, keine geraden Apostrophe', () => {
  for (const [c, table] of [['de', T.de], ['en', T.en], ...PACKS.map((x) => [x, ui[x]])]) {
    for (const [k, v] of flat(table)) {
      for (const s of texts(v)) {
        assert.ok(!/[–—]/.test(s), `${c}.${k}: Gedankenstrich in „${s}“`);
        if (c !== 'de' && c !== 'en') assert.ok(!s.includes("'"), `${c}.${k}: gerader Apostroph in „${s}“`);
      }
    }
  }
});

test('Mehrzahl folgt den Regeln der Sprache', () => {
  addTexts('pl', ui.pl);
  addTexts('ru', ui.ru);
  setLang('pl');
  assert.equal(t('recipesN', { n: 1, count: 1 }), '1 receptura');
  assert.equal(t('recipesN', { n: 3, count: 3 }), '3 receptury');
  assert.equal(t('recipesN', { n: 5, count: 5 }), '5 receptur');
  setLang('ru');
  assert.equal(t('recipesN', { n: 21, count: 21 }), '21 рецепт');
  assert.equal(t('recipesN', { n: 22, count: 22 }), '22 рецепта');
  setLang('de');
  assert.equal(t('recipesN', { n: 2, count: 2 }), '2 Rezepte');
});

test('Namenspakete: decken alle Items, Tags, Muster und Fundorte ab', () => {
  const src = json(`data/sources-${version}.json`);
  const pat = json(`data/patterns-${version}.json`);
  for (const c of PACKS) {
    const p = pack(c);
    assert.equal(p.lang, c);
    assert.equal(Object.keys(p.items).length, Object.keys(data.items).length, `${c}: Items`);
    assert.equal(Object.keys(p.tags).length, Object.keys(data.tags).length, `${c}: Tags`);
    for (const b of pat.banner) assert.equal(p.pat[b.id]?.length, 16, `${c}: Muster ${b.id}`);
    for (const k of Object.keys(src.names)) {
      if (k.startsWith('block:') && data.items[k.slice(6)]) continue; // heißt wie das Item
      if (k === 'mob:root') continue; // im Spiel ohne Namen
      assert.ok(typeof p.src[k] === 'string' && p.src[k].length, `${c}: Fundort ${k}`);
    }
    for (const v of Object.values(p.src)) assert.ok(!/ – /.test(v), `${c}: Trenner mit Gedankenstrich in „${v}“`);
  }
});

test('Namen in der gewählten Sprache, Rückfall Englisch', () => {
  const db = new DB(structuredClone(data));
  setPack(pack('fr'));
  assert.equal(db.name('oak_planks', 'fr'), 'Planches de chêne');
  assert.equal(db.name('oak_planks', 'de'), 'Eichenholzbretter');
  assert.equal(db.name('oak_planks', 'en'), 'Oak Planks');
  assert.equal(db.name('oak_planks', 'ja'), 'Oak Planks', 'falsches Paket: Englisch');
  assert.equal(db.fullName('music_disc_13', 'de'), 'Schallplatte · C418 - 13');
  assert.equal(db.ingLabel('#coals', 'fr'), 'Charbon ou Charbon de bois');
  assert.equal(loc(['Fallback', 'Rückfall'], 'items', 'gibt_es_nicht', 'fr'), 'Fallback');
  setPack(pack('ja'));
  addTexts('ja', ui.ja);
  assert.equal(db.name('torch', 'ja'), '松明');
  assert.equal(db.ingLabel(['coal', 'charcoal'], 'ja'), '石炭または木炭');
  setPack(null);
});

test('Normalisierung: alle Schriften, Akzente, Kana, Vollbreite', () => {
  assert.equal(normalize('Kłoda akacji'), 'kloda akacji');
  assert.equal(normalize('Pépite d’or'), 'pepite d or');
  assert.equal(normalize('İskelet Kafası'), 'iskelet kafasi');
  assert.equal(normalize('Деревянная кирка'), 'деревянная кирка');
  assert.equal(normalize('木のツルハシ'), normalize('木のつるはし'));
  assert.equal(normalize('１６個'), '16個');
  assert.equal(normalize('Weißes Bett'), 'weisses bett');
});

test('Mengen mit Zählwörtern: 16个火把, 松明 16個, 횃불 16개', () => {
  assert.deepEqual(parseQuery('16个火把'), { text: '火把', qty: 16 });
  assert.deepEqual(parseQuery('松明 16個'), { text: '松明', qty: 16 });
  assert.deepEqual(parseQuery('16個の松明'), { text: '松明', qty: 16 });
  assert.deepEqual(parseQuery('횃불 16개'), { text: '횃불', qty: 16 });
  assert.deepEqual(parseQuery('16 Fackeln'), { text: 'fackeln', qty: 16 });
});

test('Suche: die sechs Beispiele jeder Sprache treffen das gemeinte Item', () => {
  const aliases = buildAliases(data);
  const WANT = [/^torch$/, /^wooden_pickaxe$/, /^potion\.(long_)?night_vision$/, /^netherite_sword$/, /^beacon$/, /^oak_planks$/];
  for (const [c] of LANGS) {
    const p = c === 'de' || c === 'en' ? null : pack(c);
    const index = buildIndex(data.items, { aliases, loc: p });
    const examples = p ? ui[c].examples : T[c].examples;
    examples.forEach((q, i) => {
      const top = search(index, q, { lang: c, limit: 3 }).results[0];
      assert.ok(top && WANT[i].test(top.id), `${c}: „${q}“ → ${top ? top.id : 'nichts'}`);
    });
  }
});

test('Suche: Englisch und Deutsch gehen in jeder Sprache weiter', () => {
  const index = buildIndex(data.items, { aliases: buildAliases(data), loc: pack('ko') });
  assert.equal(search(index, 'Werkbank', { lang: 'ko' }).results[0].id, 'crafting_table');
  assert.equal(search(index, 'crafting table', { lang: 'ko' }).results[0].id, 'crafting_table');
  assert.equal(search(index, '제작대', { lang: 'ko' }).results[0].id, 'crafting_table');
});

test('Prozente in der Schreibweise der Sprache', () => {
  assert.equal(fmtPct(0.059, 'de'), '5,9 %');
  assert.equal(fmtPct(0.059, 'en'), '5.9%');
  assert.equal(fmtPct(0.059, 'tr'), '%5,9');
  assert.equal(fmtPct(0.059, 'ja'), '5.9%');
});
