// Craftionary – Namen aus dem Spiel in der gewählten Sprache
// Englisch und Deutsch stehen als Paar [en, de] in den Daten, die übrigen 12 Sprachen kommen als Paket
// (data/lang-<version>/<code>.json, gebaut von tools/build_names.mjs). Fehlt ein Name im Paket, gilt Englisch.

import { T } from './i18n.js';

let pack = null;

export function setPack(p) { pack = p || null; }
export function getPack() { return pack; }

/** Name in der Sprache: pair = [en, de] aus den Daten, sec/key = Fundstelle im Paket */
export function loc(pair, sec, key, lang) {
  if (lang === 'de') return pair ? pair[1] : key;
  if (lang !== 'en' && pack && pack.lang === lang) {
    const v = pack[sec] && pack[sec][key];
    if (v != null) return v;
  }
  return pair ? pair[0] : key;
}

/** Bindewort für „A oder B“ (Zutaten mit mehreren Möglichkeiten) aus den Oberflächentexten der Sprache */
export function orWord(lang) {
  return (T[lang] && T[lang].orJoin) || T.en.orJoin;
}
