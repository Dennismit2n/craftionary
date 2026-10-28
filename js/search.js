// Craftionary – fehlertolerante Suche (Deutsch & Englisch)
// Reines ES-Modul ohne DOM, damit es auch in Node getestet werden kann.

const STOPWORDS = new Set([
  'der', 'die', 'das', 'des', 'den', 'dem', 'ein', 'eine', 'einen', 'einer', 'eines', 'und', 'oder', 'mit',
  'aus', 'von', 'vom', 'zum', 'zur', 'fuer', 'fur', 'the', 'of', 'a', 'an', 'and', 'or', 'with', 'from', 'for',
  'ich', 'brauche', 'will', 'moechte', 'mochte', 'wie', 'mache', 'craft', 'crafte', 'craften', 'how', 'to', 'make',
  'i', 'need', 'want', 'bitte', 'please', 'herstellen', 'baue', 'bauen', 'was', 'etwas', 'zu', 'something', 'some'
]);

const UNIT_WORDS = /\b(stueck|stuck|stk|pcs|pieces?|mal|x)\b/g;

/** Kanonische Form: klein, Umlaute → ae/oe/ue, ß → ss, Akzente weg, nur [a-z0-9 ] */
export function normalize(s) {
  return String(s)
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Stamm für Vergleiche: ae/oe/ue → a/o/u, typische Plural- und Flexionsendungen ab. */
export function stem(token) {
  let t = token.replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u');
  if (t.length > 5) t = t.replace(/(ern|ies)$/, (m) => (m === 'ies' ? 'y' : ''));
  if (t.length > 4) t = t.replace(/(en|er|es|e|n|s)$/, '');
  else if (t.length === 4) t = t.replace(/[en]$/, '');
  return t;
}

/** Optimal String Alignment (Damerau-Levenshtein light) mit Abbruchgrenze */
let BUF_A = new Int32Array(64), BUF_B = new Int32Array(64), BUF_C = new Int32Array(64);
function ensure(n) {
  if (BUF_A.length < n) { BUF_A = new Int32Array(n * 2); BUF_B = new Int32Array(n * 2); BUF_C = new Int32Array(n * 2); }
}
export function editDistance(a, b, max = Infinity) {
  const n = a.length, m = b.length;
  if (Math.abs(n - m) > max) return max + 1;
  if (!n) return m;
  if (!m) return n;
  ensure(m + 1);
  let prev2 = BUF_A, prev = BUF_B, cur = BUF_C;
  for (let j = 0; j <= m; j++) { prev[j] = j; prev2[j] = 0; }
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    let rowMin = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const bj = b.charCodeAt(j - 1);
      let v = prev[j - 1] + (ai === bj ? 0 : 1);
      if (prev[j] + 1 < v) v = prev[j] + 1;
      if (cur[j - 1] + 1 < v) v = cur[j - 1] + 1;
      if (i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === bj && prev2[j - 2] + 1 < v) v = prev2[j - 2] + 1;
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = prev2; prev2 = prev; prev = cur; cur = t;
  }
  return prev[m];
}

/** Kleinste Editierdistanz, mit der `q` als zusammenhängender Teil in `t` vorkommt (Sellers). */
export function substringDistance(q, t) {
  const n = q.length, m = t.length;
  if (!n) return 0;
  ensure(m + 1);
  let prev2 = BUF_A, prev = BUF_B, cur = BUF_C;
  for (let j = 0; j <= m; j++) { prev[j] = 0; prev2[j] = 0; } // freier Start im Ziel
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    const qi = q.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const tj = t.charCodeAt(j - 1);
      let v = prev[j - 1] + (qi === tj ? 0 : 1);
      if (prev[j] + 1 < v) v = prev[j] + 1;
      if (cur[j - 1] + 1 < v) v = cur[j - 1] + 1;
      if (i > 1 && j > 1 && qi === t.charCodeAt(j - 2) && q.charCodeAt(i - 2) === tj && prev2[j - 2] + 1 < v) v = prev2[j - 2] + 1;
      cur[j] = v;
    }
    const tmp = prev2; prev2 = prev; prev = cur; cur = tmp;
  }
  let best = Infinity;
  for (let j = 0; j <= m; j++) if (prev[j] < best) best = prev[j];
  return best;
}

/**
 * Zusammengesetzte Wörter: Wie viel der Suche lässt sich in (beliebig angeordnete) Stücke
 * zerlegen, die im Namen vorkommen? „eichenbretter“ → „eichen“ + „bretter“ in „eichenholzbretter“.
 */
export function chunkCoverage(q, t, minLen = 3) {
  const used = new Uint8Array(t.length);
  let i = 0, matched = 0, chunks = 0;
  while (i < q.length) {
    let bestLen = 0, bestPos = -1;
    for (let len = Math.min(q.length - i, t.length); len >= minLen; len--) {
      const part = q.substr(i, len);
      let pos = t.indexOf(part);
      while (pos >= 0) {
        let free = true;
        for (let k = pos; k < pos + len; k++) if (used[k]) { free = false; break; }
        if (free) break;
        pos = t.indexOf(part, pos + 1);
      }
      if (pos >= 0) { bestLen = len; bestPos = pos; break; }
    }
    if (bestLen) {
      for (let k = bestPos; k < bestPos + bestLen; k++) used[k] = 1;
      matched += bestLen;
      chunks++;
      i += bestLen;
    } else {
      i++;
    }
  }
  return { qCov: q.length ? matched / q.length : 0, kCov: t.length ? matched / t.length : 0, chunks, matched };
}

/** Wie viele Tippfehler wir bei einer Wortlänge tolerieren */
export function allowedEdits(len) {
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  return 3;
}

/** Menge aus der Eingabe lösen: „16 Fackeln“, „16x fackel“, „fackeln x16“, „fackeln 16x“ */
export function parseQuery(raw) {
  let text = normalize(raw);
  let qty = null;
  let m = text.match(/^(\d{1,5})\s*x?\s+(.+)$/) || text.match(/^(\d{1,5})x\s*(.+)$/);
  if (m) {
    qty = parseInt(m[1], 10);
    text = m[2];
  } else {
    m = text.match(/^(.+?)\s+x\s*(\d{1,5})$/) || text.match(/^(.+?)\s+(\d{1,5})\s*x$/) || text.match(/^(.+?)\s*x(\d{1,5})$/);
    if (m) {
      qty = parseInt(m[2], 10);
      text = m[1];
    }
  }
  if (qty !== null) text = text.replace(UNIT_WORDS, ' ').replace(/\s+/g, ' ').trim();
  if (qty !== null && (qty < 1 || !text)) qty = null;
  return { text, qty };
}

function tokenize(norm) {
  return norm.split(' ').filter(Boolean);
}

function trigrams(s) {
  const out = new Set();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.substr(i, 3));
  return out;
}

function makeKey(str, lang, kind) {
  const n = normalize(str);
  const all = tokenize(n);
  const sig = all.filter((t) => !STOPWORDS.has(t));
  const tokens = sig.length ? sig : all;
  const c = all.join('');
  // Wortgrenzen (Start/Ende jedes Worts im zusammengeschriebenen Namen)
  const starts = new Set(), ends = new Set();
  let off = 0;
  for (const t of all) { starts.add(off); off += t.length; ends.add(off); }
  return { lang, kind, n, c, tokens, stems: tokens.map(stem), starts, ends, tri: trigrams(c) };
}

const TECHNICAL = /(spawn_egg|command_block|structure_|jigsaw|barrier|debug_stick|knowledge_book|test_block|test_instance|^light$|^air$|petrified_oak_slab|^bedrock$|end_portal_frame|reinforced_deepslate|spawner$|budding_amethyst|^vault$|trial_spawner|farmland|dirt_path|chorus_plant|frogspawn|infested_)/;

/**
 * Index aufbauen.
 * items: { id: {n:[en,de], sub?:[en,de], group?, base?, potion?} }
 * extra: { aliases: { id: [{text, lang}] } }
 */
export function buildIndex(items, extra = {}) {
  const entries = [];
  const aliases = extra.aliases || {};
  for (const [id, it] of Object.entries(items)) {
    if (it.group || id === 'air') continue;
    const keys = [];
    const [en, de] = it.n;
    const subEn = it.sub ? it.sub[0] : '';
    const subDe = it.sub ? it.sub[1] : '';
    keys.push(makeKey(de, 'de', 'name'));
    if (normalize(en) !== normalize(de)) keys.push(makeKey(en, 'en', 'name'));
    if (subDe) keys.push(makeKey(`${de} ${subDe}`, 'de', 'sub'), makeKey(subDe, 'de', 'subonly'));
    if (subEn) keys.push(makeKey(`${en} ${subEn}`, 'en', 'sub'), makeKey(subEn, 'en', 'subonly'));
    keys.push(makeKey(id.replace(/[._]/g, ' '), 'id', 'id'));
    for (const a of aliases[id] || []) keys.push(makeKey(a.text, a.lang || 'any', 'alias'));
    entries.push({ id, it, keys, technical: TECHNICAL.test(id), craftable: !!it.mk });
  }
  return { entries };
}

// Vergleicht ein Suchwort mit einem Wort aus dem Namen. 0 … 1
function wordScore(qt, qs, kt, ks) {
  if (kt === qt) return 1;
  // Plural/Flexion („Fackeln“ → Fackel, „Äxte“ → Axt), aber nicht „Eisen“ → „Eis“
  if (ks === qs && qs.length >= 3 && (kt.length >= 4 || /(ae|oe|ue)/.test(qt))) return 0.97;
  if (qt.length >= 3 && kt.startsWith(qt)) return 0.9 - 0.2 * (1 - qt.length / kt.length);
  // deutsches Kompositum: Grundwort steht hinten („Holzaxt“ ist eine Axt)
  if (qs.length >= 3 && ks.length > qs.length && ks.endsWith(qs)) return 0.86 - 0.1 * (1 - qs.length / ks.length);
  if (qt.length >= 4 && kt.includes(qt)) return 0.82 - 0.15 * (1 - qt.length / kt.length);
  if (kt.length >= 4 && qt.includes(kt)) return 0.8 * (kt.length / qt.length) + 0.1;
  const allowed = allowedEdits(qt.length);
  if (allowed > 0) {
    const d = editDistance(qs, ks, allowed);
    if (d <= allowed) return 0.88 * (1 - (d / Math.max(qs.length, ks.length)) * 0.9);
    if (qt.length >= 6 && kt.length > qt.length) {
      const sd = substringDistance(qt, kt);
      if (sd <= (qt.length >= 10 ? allowed : allowed - 1)) return 0.78 * (1 - sd / qt.length);
    }
  }
  return 0;
}

function scoreKey(q, key) {
  const { c: qc, tokens: qtokens, stems: qstems } = q;
  if (!qc) return 0;
  if (qc === key.c) return 100;
  const ratio = Math.min(1, qc.length / key.c.length);

  // wortweise vergleichen (und merken, welche Namenswörter getroffen wurden)
  let sum = 0, wsum = 0, matched = 0, exactWords = 0, stemWords = 0;
  const hit = new Uint8Array(key.tokens.length);
  for (let i = 0; i < qtokens.length; i++) {
    const qt = qtokens[i], qs = qstems[i];
    let best = 0, bi = -1;
    for (let j = 0; j < key.tokens.length; j++) {
      const s = wordScore(qt, qs, key.tokens[j], key.stems[j]);
      if (s > best) { best = s; bi = j; if (s === 1) break; }
    }
    if (best >= 0.5) { matched++; hit[bi] = 1; }
    if (best === 1) exactWords++;
    else if (best >= 0.97) stemWords++;
    const w = Math.max(2, qt.length);
    sum += best * w;
    wsum += w;
  }
  const tokenScore = wsum ? sum / wsum : 0;
  const cover = key.tokens.length ? hit.reduce((a, b) => a + b, 0) / key.tokens.length : 0;

  // 1) alle Suchwörter sind ganze Wörter des Namens („bed“ → „Red Bed“, nicht „Bedrock“)
  if (exactWords === qtokens.length) return 92 + 6 * ratio + 1.5 * cover;
  if (exactWords + stemWords === qtokens.length) return 89 + 6 * ratio + 1.5 * cover;

  // 2) zusammenhängend im Namen enthalten
  const pos = key.c.indexOf(qc);
  if (pos === 0) return (key.ends.has(qc.length) ? 91 : 87) + 6 * ratio;
  if (pos > 0 && qc.length >= 3) {
    const atStart = key.starts.has(pos), atEnd = key.ends.has(pos + qc.length);
    const base = atStart ? 84 : atEnd ? 82 : 76; // Ende eines Worts = Grundwort im Kompositum
    return base + 6 * ratio - Math.min(3, pos * 0.15);
  }

  let s = tokenScore * 72 + cover * 6;
  if (matched < qtokens.length) s *= 0.85 + 0.15 * (matched / qtokens.length);

  // gemeinsame Trigramme als günstiger Vorfilter für die teuren Vergleiche
  let shared = 0;
  if (q.tri.size) for (const g of q.tri) if (key.tri.has(g)) shared++;
  const allowedFull = allowedEdits(qc.length);

  // 3) Kompositum in anderer Reihenfolge / Mittelteil weggelassen („eichenbretter“)
  if (qc.length >= 6 && shared * 3 >= qc.length * 0.6) {
    const cc = chunkCoverage(qc, key.c);
    if (cc.qCov >= 0.85 && cc.matched / Math.max(1, cc.chunks) >= 4) {
      s = Math.max(s, (62 + 18 * cc.kCov) * cc.qCov);
    }
  }

  // 4) ganzes Wort mit Tippfehlern („holzspitzhake“, „werkbnak“)
  if (allowedFull > 0) {
    const d = editDistance(qc, key.c, allowedFull);
    if (d <= allowedFull) s = Math.max(s, 86 - d * 6 - Math.abs(qc.length - key.c.length) * 0.5);
    else if (qc.length >= 7 && key.c.length > qc.length && shared >= Math.max(1, qc.length - 2 - 3 * allowedFull)) {
      const sd = substringDistance(qc, key.c);
      if (sd <= (qc.length >= 10 ? allowedFull : allowedFull - 1)) s = Math.max(s, 72 - sd * 6 + 6 * ratio);
    }
  }
  return s;
}

// Reihenfolge wie im Spiel: Werkzeug-/Rüstungsstufen, Farben, Holzarten
const FAMILIES = [
  ['wooden', 'leather', 'stone', 'copper', 'chainmail', 'iron', 'golden', 'diamond', 'netherite'],
  ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'],
  ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'poplar', 'bamboo', 'crimson', 'warped'],
].map((list, li) => ({ li, list, sorted: [...list].sort((a, b) => b.length - a.length) }));

export function familyOf(id) {
  const [base, variant] = id.split('.');
  for (const f of FAMILIES) {
    for (const p of f.sorted) {
      if (base.startsWith(p + '_') && base.length > p.length + 1) {
        return { key: `${f.li}:${base.slice(p.length + 1)}${variant ? '.' + variant : ''}`, order: f.list.indexOf(p) };
      }
    }
  }
  return null;
}

/**
 * Suchen.
 * @returns {{text:string, qty:number|null, results:{id,score,key}[]}}
 */
export function search(index, raw, { lang = 'de', limit = 30, filter = null, minScore = 46 } = {}) {
  const { text, qty } = parseQuery(raw);
  const tokensAll = tokenize(text);
  const sig = tokensAll.filter((t) => !STOPWORDS.has(t));
  const tokens = sig.length ? sig : tokensAll;
  const qc = tokens.join('');
  const q = { c: qc, tokens, stems: tokens.map(stem), tri: trigrams(qc) };
  const results = [];
  if (!q.c) return { text, qty, results };
  for (const e of index.entries) {
    if (filter && !filter(e.id)) continue;
    let best = 0, bestKey = null;
    for (const k of e.keys) {
      let s = scoreKey(q, k);
      if (k.kind === 'subonly') s -= 6;
      if (k.kind === 'id') s -= 3;
      if (k.lang === lang) s += 1.5;
      if (s > best) { best = s; bestKey = k; }
      if (best >= 100) break;
    }
    if (best <= 0) continue;
    if (e.technical) best -= 6;
    if (e.craftable) best += 1;
    if (best >= minScore) results.push({ id: e.id, score: best, key: bestKey });
  }
  // Verwandte Varianten zusammenhalten und in Spielreihenfolge zeigen
  const fam = new Map();
  for (const r of results) {
    const f = familyOf(r.id);
    if (!f) continue;
    r.fam = f;
    const g = fam.get(f.key);
    if (!g || r.score > g) fam.set(f.key, r.score);
  }
  for (const r of results) {
    if (!r.fam) continue;
    const max = fam.get(r.fam.key);
    if (max - r.score <= 8) r.score = max - 0.001 * r.fam.order;
  }
  results.sort((a, b) => b.score - a.score || a.key.c.length - b.key.c.length || a.id.localeCompare(b.id));
  return { text, qty, results: results.slice(0, limit) };
}

/**
 * Automatische Zusatznamen für Tränke und Pfeile, damit auch die umgangssprachlichen
 * Zusammensetzungen gefunden werden: „Heilungstrank“, „Nachtsichttrank“, „Giftpfeil“,
 * „healing potion“, „poison arrow“ …  Abgeleitet aus den offiziellen Namen.
 */
export function buildAliases(data) {
  const out = {};
  const add = (id, text, lang) => { (out[id] ||= []).push({ text, lang }); };
  const { items } = data;
  const deWord = { potion: ['trank', 'strank'], splash_potion: ['wurftrank', 'swurftrank'],
    lingering_potion: ['verweiltrank', 'sverweiltrank'], tipped_arrow: ['pfeil', 'spfeil'] };
  const enWord = { potion: 'potion', splash_potion: 'splash potion', lingering_potion: 'lingering potion', tipped_arrow: 'arrow' };
  // Kurzformen, die Spieler wirklich benutzen
  const shortDe = { Heilung: ['Heil'], Vergiftung: ['Gift'], Sprungkraft: ['Sprung'], Feuerresistenz: ['Feuerschutz'],
    Schadens: ['Schaden'], Schnelligkeit: ['Speed', 'Geschwindigkeits'], 'sanften Falls': ['Sanftfall', 'Fallschirm'] };
  for (const [id, it] of Object.entries(items)) {
    if (!(it.base && it.potion)) continue;
    const [en, de] = it.n;
    const mDe = de.match(/\b(?:der|des)\s+(.+)$/);
    const mEn = en.match(/\bof\s+(.+)$/);
    if (mDe) {
      const word = mDe[1];
      const variants = [word.replace(/\s+/g, ''), ...(shortDe[word] || [])];
      if (/\bdes\s/.test(de) && /s$/.test(word)) variants.push(word.replace(/s$/, '').replace(/\s+/g, ''));
      for (const v of variants) for (const w of deWord[it.base]) add(id, `${v}${w}`, 'de');
    }
    if (mEn) add(id, `${mEn[1]} ${enWord[it.base]}`, 'en');
    if (it.potion.startsWith('strong_')) { add(id, `${de} II`, 'de'); add(id, `${en} II`, 'en'); }
    if (it.potion.startsWith('long_')) { add(id, `${de} lang`, 'de'); add(id, `${en} long`, 'en'); }
  }
  // Rüstung: „Eisenrüstung“, „Eisenbrustpanzer“, „iron armor“ …
  const MAT = { leather: ['Leder', 'leather'], copper: ['Kupfer', 'copper'], chainmail: ['Ketten', 'chainmail'],
    iron: ['Eisen', 'iron'], golden: ['Gold', 'gold'], diamond: ['Diamant', 'diamond'], netherite: ['Netherit', 'netherite'] };
  const SLOT = { helmet: ['Helm'], chestplate: ['Brustpanzer', 'Brustplatte', 'Harnisch'], leggings: ['Hose', 'Beinschutz'], boots: ['Stiefel', 'Schuhe'] };
  for (const [mat, [de, en]] of Object.entries(MAT)) {
    for (const [slot, words] of Object.entries(SLOT)) {
      const id = `${mat}_${slot}`;
      if (!items[id]) continue;
      add(id, `${de}rüstung`, 'de');
      add(id, `${en} armor`, 'en');
      for (const w of words) add(id, `${de}${w.toLowerCase()}`, 'de');
    }
  }

  // Umgangssprache, die sonst nicht gefunden würde (bewusst kurz gehalten)
  const manual = {
    chest: [['Kiste', 'de']],
    crafting_table: [['Crafting Tisch', 'de']],
    stick: [['Holzstock', 'de']],
    tnt: [['Dynamit', 'de'], ['Sprengstoff', 'de']],
    enchanting_table: [['Verzauberungstisch', 'de'], ['enchantment table', 'en']],
    elytra: [['Flügel', 'de'], ['Gleiter', 'de'], ['wings', 'en']],
    golden_apple: [['Goldapfel', 'de']],
    enchanted_golden_apple: [['Notch Apfel', 'de'], ['notch apple', 'en']],
    shield: [['Schutzschild', 'de']],
    jukebox: [['Jukebox', 'de']],
    beacon: [['Beacon', 'de']],
  };
  for (const [id, list] of Object.entries(manual)) {
    if (!items[id]) continue;
    for (const [text, lang] of list) add(id, text, lang);
  }
  return out;
}
