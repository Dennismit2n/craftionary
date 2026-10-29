// Craftionary – App: Start, Navigation, Ansichten, Suche, Einstellungen

import { DB, STATIONS, STATION_BY_ID } from './db.js';
import { buildIndex, buildAliases, search } from './search.js';
import { t, setLang, getLang, detectLang, numberFmt } from './i18n.js';
import { Icons, initialsOf } from './icons.js';
import { glyphUrl } from './glyphs.js';
import { h, fill, Ctx, recipeGui, legend, notes, chip, stationName, stationTitle, fmtSeconds, fmtTicks, arrow } from './ui.js';

const LS = {
  get(k, d = null) { try { const v = localStorage.getItem('craftionary.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('craftionary.' + k, JSON.stringify(v)); } catch { /* egal */ } },
};

const POPULAR = ['crafting_table', 'furnace', 'chest', 'torch', 'white_bed', 'stick', 'oak_planks', 'ladder', 'oak_boat', 'bucket',
  'shield', 'bow', 'iron_pickaxe', 'diamond_sword', 'enchanting_table', 'anvil', 'ender_chest', 'beacon', 'piston', 'hopper',
  'rail', 'compass', 'bread', 'potion.night_vision', 'firework_rocket', 'netherite_ingot'];
const EXAMPLES = { de: ['16 Fackeln', 'Holzspitzhake', 'Trank der Nachtsicht', 'Netheritschwert', 'Leuchtfeuer', 'eichenbretter'],
  en: ['16 torches', 'wodden pickaxe', 'potion of night vision', 'netherite sword', 'beacon', 'oak planks'] };
// Reiter-Reihenfolge wie im Rezeptbuch des Spiels (Werkbank: Bauen, Redstone, Ausrüstung, Sonstiges; Ofen: Essen, Blöcke, Sonstiges)
const CAT_ORDER = ['building', 'redstone', 'equipment', 'food', 'blocks', 'misc', 'special', 'other', 'upgrade', 'trim', 'potions', 'splash', 'lingering'];
const catRank = (c) => { const i = CAT_ORDER.indexOf(c); return i < 0 ? 99 : i; };
const FUEL_CHOICES = ['coal', 'charcoal', 'coal_block', 'lava_bucket', 'blaze_rod', 'dried_kelp_block', 'oak_log', 'oak_planks', 'stick', 'bamboo'];
const GLYPH_OF = { crafting: 'crafting', inventory: 'inventory', furnace: 'furnace', blast_furnace: 'blast_furnace', smoker: 'smoker',
  campfire: 'campfire', stonecutter: 'stonecutter', smithing: 'smithing', brewing: 'brewing' };
const TEX_OF = { crafting: 'crafting_table', inventory: 'chest', furnace: 'furnace', blast_furnace: 'blast_furnace', smoker: 'smoker',
  campfire: 'campfire', stonecutter: 'stonecutter', smithing: 'smithing_table', brewing: 'brewing_stand' };

class App {
  constructor() {
    this.icons = new Icons();
    this.cyclers = [];
    this.tick = 0;
    this.view = { kind: 'home' };
    this.stack = [];
    this.qty = 1;
    this.fuel = LS.get('fuel', 'coal');
    this.sandbox = {};
    this.$ = (s) => document.querySelector(s);
  }

  // ======================================================================= Start
  async start() {
    setLang(detectLang());
    document.documentElement.lang = getLang();
    this.renderStatic();
    this.$('#main').replaceChildren(h('p', { class: 'loading' }, t('loading')));
    try {
      const vs = await fetch('data/versions.json').then((r) => r.json());
      const data = await fetch(`data/${vs.default}.json`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
      this.db = new DB(data);
      this.index = buildIndex(data.items, { aliases: buildAliases(data) });
    } catch (e) {
      console.error(e);
      this.$('#main').replaceChildren(h('p', { class: 'loading' }, t('loadFailed')));
      return;
    }
    await this.icons.init();
    this.icons.onChange(() => { this.renderHotbar(); this.render(); });
    this.bind();
    this.renderStatic();
    this.renderHotbar();
    this.route();
    setInterval(() => { this.tick++; for (const fn of this.cyclers) fn(this.tick); }, 1000);
    this.registerSW();
  }

  addCycler(fn) { this.cyclers.push(fn); }

  // ======================================================================= Navigation
  route() {
    const hash = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (!hash) this.view = { kind: 'home' };
    else if (hash.startsWith('s-') && STATION_BY_ID[hash.slice(2)]) this.view = { kind: 'station', id: hash.slice(2), sel: null, cat: 'all' };
    else if (this.db && this.db.items[hash]) this.view = { kind: 'item', id: hash, tab: 'make' };
    else this.view = { kind: 'home' };
    this.render();
  }

  go(view, hash) {
    if (this.view && this.view.kind !== 'home') this.stack.push(this.view);
    if (this.stack.length > 50) this.stack.shift();
    this.view = view;
    try { history.replaceState(null, '', hash ? '#' + hash : location.pathname + location.search); } catch { /* Sandbox */ }
    this.render();
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  back() {
    const v = this.stack.pop();
    this.view = v || { kind: 'home' };
    const hash = this.view.kind === 'item' ? this.view.id : this.view.kind === 'station' ? 's-' + this.view.id : '';
    try { history.replaceState(null, '', hash ? '#' + hash : location.pathname + location.search); } catch { /* Sandbox */ }
    this.render();
  }

  openItem(id, qty = null) {
    if (!this.db.items[id]) return;
    if (qty) this.qty = qty;
    else if (!(this.view.kind === 'item' && this.view.id === id)) this.qty = 1;
    this.closeSuggest();
    this.go({ kind: 'item', id, tab: 'make' }, id);
  }

  openStation(id, sel = null) {
    this.closeSuggest();
    this.go({ kind: 'station', id, sel, cat: 'all', sandbox: false }, 's-' + id);
  }

  // ======================================================================= Grundgerüst
  renderStatic() {
    const lang = getLang();
    document.documentElement.lang = lang;
    const q = this.$('#q');
    q.placeholder = t('searchPlaceholder');
    q.setAttribute('aria-label', t('searchLabel'));
    this.$('#tagline').textContent = t('tagline', { v: this.db ? this.db.meta.version : '' });
    for (const b of document.querySelectorAll('[data-lang]')) b.setAttribute('aria-pressed', b.dataset.lang === lang ? 'true' : 'false');
    this.$('#btn-settings').setAttribute('aria-label', t('settings'));
    this.$('#btn-settings').title = t('settings');
    this.$('#hotbar').setAttribute('aria-label', t('stations'));
  }

  renderHotbar() {
    const bar = this.$('#hotbar');
    const active = this.view.kind === 'station' ? this.view.id : null;
    const can = this.view.kind === 'item' ? this.db.stationsFor(this.view.id) : null;
    bar.replaceChildren(...STATIONS.map((st, i) => {
      const tex = this.icons.url(TEX_OF[st.id]);
      const img = h('img', { src: tex || glyphUrl(GLYPH_OF[st.id]), alt: '', draggable: 'false', class: tex ? 'hb-tex' : 'hb-glyph' });
      const name = stationName(this.db, st.id);
      const b = h('button', {
        class: `hb-slot${active === st.id ? ' is-active' : ''}${can ? (can.has(st.id) ? ' is-can' : ' is-dim') : ''}`,
        type: 'button', title: `${i + 1} · ${name}`, 'aria-label': `${name} (${i + 1})`,
        'aria-current': active === st.id ? 'page' : null,
        onClick: () => this.openStation(st.id),
      }, img, h('span', { class: 'hb-key', 'aria-hidden': 'true' }, i + 1));
      return b;
    }));
    const label = this.$('#hotbar-label');
    if (active) label.textContent = stationName(this.db, active);
    else if (can && can.size) label.textContent = [...can].map((s) => stationName(this.db, s)).join(' · ');
    else label.textContent = t('stationHint');
  }

  // ======================================================================= Ansichten
  render() {
    if (!this.db) return;
    this.cyclers = [];
    this.renderHotbar();
    const main = this.$('#main');
    let node;
    if (this.view.kind === 'item') node = this.viewItem();
    else if (this.view.kind === 'station') node = this.viewStation();
    else node = this.viewHome();
    main.replaceChildren(node);
    main.dataset.view = this.view.kind;
  }

  backBar() {
    if (!this.stack.length && this.view.kind === 'home') return null;
    return h('nav', { class: 'crumbs' },
      h('button', { class: 'btn btn--ghost', type: 'button', onClick: () => this.back() }, '← ', t('back')),
      h('button', { class: 'btn btn--ghost', type: 'button', onClick: () => { this.stack = []; this.go({ kind: 'home' }, ''); } }, t('home')));
  }

  textureBanner() {
    if (this.icons.available || LS.get('bannerDismissed', false)) return null;
    return h('aside', { class: 'banner', role: 'note' },
      h('p', null, t('texturesBanner')),
      h('div', { class: 'banner-actions' },
        h('button', { class: 'btn btn--accent', type: 'button', onClick: () => this.openSettings('textures') }, t('texturesBannerAction')),
        h('button', { class: 'btn btn--ghost', type: 'button', onClick: (e) => { LS.set('bannerDismissed', true); e.target.closest('.banner').remove(); } }, t('dismiss'))));
  }

  viewHome() {
    const lang = getLang();
    const ex = EXAMPLES[lang].map((q) => h('button', { class: 'chip chip--btn', type: 'button', onClick: () => this.runQuery(q) }, q));
    const pop = POPULAR.filter((id) => this.db.items[id]).map((id) => this.itemTile(id));
    const stations = STATIONS.map((st, i) => {
      const tex = this.icons.url(TEX_OF[st.id]);
      const n = this.db.byStation.get(st.id).filter((r) => r.t !== 'repair').length;
      return h('button', { class: 'st-tile', type: 'button', onClick: () => this.openStation(st.id) },
        h('img', { src: tex || glyphUrl(GLYPH_OF[st.id]), alt: '', class: tex ? 'hb-tex' : 'hb-glyph' }),
        h('span', { class: 'st-name' }, stationName(this.db, st.id)),
        h('span', { class: 'st-count' }, h('kbd', { class: 'st-key', title: t('stationHint') }, i + 1), t('recipesN', { n: numberFmt(n), count: n })));
    });
    return h('div', { class: 'home' },
      h('section', { class: 'hero' },
        h('h1', { class: 'hero-title' }, lang === 'de' ? 'Sag, was du brauchst.' : 'Say what you need.'),
        h('p', { class: 'hero-sub' }, lang === 'de'
          ? 'Tippfehler, Mehrzahl, Englisch oder Deutsch: Craftionary findet das Rezept und zeigt es dir so, wie du es im Spiel legst.'
          : 'Typos, plurals, English or German: Craftionary finds the recipe and shows it the way you place it in the game.'),
        h('div', { class: 'chips' }, ex)),
      this.textureBanner(),
      h('section', { class: 'block' },
        h('h2', { class: 'block-title' }, t('stations')),
        h('div', { class: 'st-grid' }, stations)),
      h('section', { class: 'block' },
        h('h2', { class: 'block-title' }, lang === 'de' ? 'Oft gebraucht' : 'Often needed'),
        h('div', { class: 'tile-grid' }, pop)),
      this.aboutBlock());
  }

  aboutBlock() {
    return h('footer', { class: 'about' },
      h('p', null, t('aboutText', { r: numberFmt(this.db.recipes.length), v: this.db.meta.version })),
      h('p', { class: 'muted small' }, t('keys')),
      h('p', { class: 'disclaimer' }, t('disclaimer')));
  }

  itemTile(id) {
    const lang = getLang();
    const it = this.db.items[id];
    const pc = it.potion ? (this.db.potions[it.potion]?.color ?? this.db.meta.defaultPotionColor) : null;
    return h('button', { class: 'tile', type: 'button', onClick: () => this.openItem(id), dataset: { tip: id } },
      h('span', { class: 'slot slot--item' }, this.icons.el(id, { initials: initialsOf(this.db.name(id, lang)), potionColor: pc })),
      h('span', { class: 'tile-name' }, this.db.name(id, lang)));
  }

  // ----------------------------------------------------------------------- Item
  viewItem() {
    const db = this.db;
    const lang = getLang();
    const id = this.view.id;
    const it = db.items[id];
    const recipes = db.recipesFor(id);
    const uses = db.usagesOf(id);
    const tab = this.view.tab || 'make';
    const pinfo = db.potionInfo(id);
    const other = lang === 'de' ? it.n[0] : it.n[1];
    const sub = db.sub(id, lang);
    const head = h('header', { class: 'item-head' },
      h('div', { class: 'slot slot--big item-ico' }, this.icons.el(id, { initials: initialsOf(db.name(id, lang)), potionColor: pinfo ? pinfo.color : null })),
      h('div', { class: 'item-titles' },
        h('h1', { class: `item-name rarity-${it.r || 'common'}` }, db.name(id, lang)),
        sub ? h('p', { class: 'item-sub' }, sub) : null,
        h('p', { class: 'item-other' }, h('span', { class: 'muted' }, t('otherLang') + ': '), other,
          h('code', { class: 'item-id' }, 'minecraft:' + (it.base || id)),
          h('button', { class: 'btn btn--tiny', type: 'button', onClick: (e) => this.copy('minecraft:' + (it.base || id), e.currentTarget) }, t('copyId'))),
        this.itemFacts(id, pinfo)));
    const qtyBox = this.qtyControl(() => this.render());
    const tabs = h('div', { class: 'tabs', role: 'tablist' },
      this.tabBtn('make', `${t('tabMake')} (${recipes.length})`, tab),
      this.tabBtn('use', `${t('tabUse')} (${uses.length})`, tab));
    const body = tab === 'make' ? this.makeList(id, recipes) : this.useList(id, uses);
    return h('div', { class: 'item-view' }, this.backBar(), head, this.textureBanner(), h('div', { class: 'item-bar' }, tabs, tab === 'make' && recipes.length ? qtyBox : null), body);
  }

  tabBtn(key, label, cur) {
    return h('button', { class: `tab${cur === key ? ' is-on' : ''}`, type: 'button', role: 'tab', 'aria-selected': cur === key ? 'true' : 'false',
      onClick: () => { this.view.tab = key; this.render(); } }, label);
  }

  qtyControl(onChange) {
    const input = h('input', { id: 'qty', class: 'qty-in', type: 'number', min: '1', max: '9999', inputmode: 'numeric', value: String(this.qty), 'aria-label': t('amount') });
    const set = (v) => { this.qty = Math.max(1, Math.min(9999, Math.floor(v) || 1)); input.value = String(this.qty); onChange(); };
    input.addEventListener('change', () => set(+input.value));
    return h('div', { class: 'qty' },
      h('label', { for: 'qty' }, t('amount')),
      h('button', { class: 'btn btn--step', type: 'button', 'aria-label': '−1', onClick: () => set(this.qty - 1) }, '−'),
      input,
      h('button', { class: 'btn btn--step', type: 'button', 'aria-label': '+1', onClick: () => set(this.qty + 1) }, '+'),
      h('div', { class: 'qty-quick' }, [16, 64].map((n) => h('button', { class: 'chip chip--btn', type: 'button', onClick: () => set(n) }, n))));
  }

  itemFacts(id, pinfo) {
    const db = this.db;
    const it = db.items[id];
    const lang = getLang();
    const li = lang === 'de' ? 1 : 0;
    const out = [];
    if (it.r) out.push(chip(t('rarity.' + it.r), 'rarity-' + it.r));
    out.push(chip(`${t('stack')}: ${it.s || 64}`));
    if (it.dmg) out.push(chip(`${t('durability')}: ${numberFmt(it.dmg)}`));
    if (it.fuel) out.push(chip(`${t('burnTime')}: ${fmtSeconds(it.fuel / 20)} · ${t('burnsItems', { n: numberFmt(it.fuel / 200, 2), count: it.fuel / 200 })}`, 'fuel'));
    if (it.bfuel) out.push(chip(t('brewFuel', { n: it.bfuel }), 'fuel'));
    if (pinfo) {
      for (const e of pinfo.effects) {
        const lvl = e.amp > 0 ? ' ' + (db.ui['potion.potency.' + e.amp] || ['', ''])[li] : '';
        const dur = e.instant ? t('instant') : fmtTicks(e.ticks);
        out.push(chip(`${e.n[li]}${lvl} (${dur})`, e.cat === 'h' ? 'bad' : 'good'));
      }
      if (pinfo.long) out.push(chip(t('longVariant'), 'info'));
      if (pinfo.strong) out.push(chip(t('strongVariant'), 'info'));
    }
    return out.length ? h('div', { class: 'facts' }, out) : null;
  }

  makeList(id, recipes) {
    const db = this.db;
    if (!recipes.length) {
      const extra = id === 'potion.water' ? h('p', null, t('obtainWater')) : null;
      return h('div', { class: 'empty' }, h('p', null, t('noRecipe')), extra, db.repairable.has(id) ? this.repairNote() : null);
    }
    const perStation = new Map();
    for (const r of recipes) perStation.set(r.station, (perStation.get(r.station) || 0) + 1);
    const seen = new Map();
    const cards = recipes.map((r) => {
      const n = (seen.get(r.station) || 0) + 1;
      seen.set(r.station, n);
      return this.recipeCard(r, { index: n, of: perStation.get(r.station) });
    });
    const firstCraft = recipes.find((r) => r.t === 'shaped' || r.t === 'shapeless');
    return h('div', { class: 'cards' }, cards, firstCraft ? this.materials(id, firstCraft) : null, db.repairable.has(id) ? this.repairNote() : null);
  }

  repairNote() {
    return h('p', { class: 'note-line' }, '🛠 ', t('special.repair'));
  }

  recipeCard(r, { index = 1, of = 1, grid = 3, compact = false } = {}) {
    const db = this.db;
    const ctx = new Ctx(this, { qty: this.qty });
    const plan = db.plan(r, this.qty);
    const st = r.station;
    // Braustand: immer genau die gewünschte Flaschenzahl zeigen (1 Trank = 1 Flasche), damit Fenster und Legende übereinstimmen
    const gui = recipeGui(ctx, r, { plan: this.qty > 1 || st === 'brewing' ? plan : null, grid, fuelId: this.fuel, onPick: (o) => this.openItem(o.out.id) });
    const lg = legend(ctx, r, plan);
    const tex = this.icons.url(TEX_OF[st]);
    const headLeft = h('button', { class: 'rc-station', type: 'button', onClick: () => this.openStation(st, r.id) },
      h('img', { src: tex || glyphUrl(GLYPH_OF[st]), alt: '', class: tex ? 'hb-tex' : 'hb-glyph' }),
      stationName(db, st));
    const head = h('header', { class: 'rc-head' }, headLeft,
      of > 1 ? h('span', { class: 'rc-count' }, t('recipeOf', { i: index, n: of })) : null,
      r.t === 'trim' && r.pat ? h('span', { class: 'rc-count' }, db.sub(db.ingItems(r.tpl)[0], getLang())) : null);
    const planLine = this.planLine(r, plan);
    const fuelPick = ['furnace', 'blast_furnace', 'smoker'].includes(st) ? this.fuelPicker(r, plan) : null;
    return h('article', { class: `rc rc--${st}${compact ? ' rc--compact' : ''}` },
      head,
      h('div', { class: 'rc-body' }, h('div', { class: 'rc-gui' }, gui), h('div', { class: 'rc-side' }, lg, planLine, fuelPick)),
      notes(ctx, r, { grid, plan }));
  }

  planLine(r, plan) {
    if (this.qty <= 1 || !r.out) return null;
    const parts = [];
    if (r.station === 'brewing') parts.push(t('brews', { n: plan.brews }));
    else parts.push(plan.crafts === 1 ? t('craftsOne') : t('crafts', { n: plan.crafts }));
    parts.push(t('youGet', { n: numberFmt(r.station === 'brewing' ? plan.qty : plan.total) }));
    if (plan.leftover) parts.push(t('leftover', { n: plan.leftover }));
    const lines = [h('p', { class: 'plan' }, parts.join(' · '))];
    if (plan.rounds > 1) lines.push(h('p', { class: 'plan plan--warn' }, t('rounds', { n: plan.rounds })));
    if (plan.seconds) lines.push(h('p', { class: 'plan muted' }, `${t('time')}: ${fmtSeconds(plan.seconds)}`));
    return h('div', { class: 'plan-box' }, lines);
  }

  fuelPicker(r, plan) {
    const db = this.db;
    const lang = getLang();
    const sel = h('select', { id: `fuel-${r.id}`, class: 'select', 'aria-label': t('fuel') },
      FUEL_CHOICES.filter((f) => db.items[f] && db.items[f].fuel).map((f) => h('option', { value: f, selected: f === this.fuel ? 'selected' : null }, db.name(f, lang))));
    sel.addEventListener('change', () => { this.fuel = sel.value; LS.set('fuel', this.fuel); this.render(); });
    const f = db.fuelFor(r, this.fuel, plan.crafts);
    const txt = f ? `${t('fuelNeed', { n: numberFmt(f.count), item: db.name(this.fuel, lang), q: numberFmt(plan.crafts), count: plan.crafts })} · ${t('fuelPer', { per: numberFmt(f.perFuel, 2), count: f.perFuel })}` : '';
    return h('div', { class: 'fuel-box' }, h('label', { for: `fuel-${r.id}` }, t('fuel')), sel, h('span', { class: 'muted' }, txt));
  }

  materials(id, r) {
    const db = this.db;
    const lang = getLang();
    const mode = LS.get('matMode', 'direct');
    const wrap = h('section', { class: 'materials' });
    const draw = () => {
      const curMode = LS.get('matMode', 'direct');
      let rows;
      let left = [];
      if (curMode === 'raw') {
        const b = db.breakdown(id, this.qty);
        rows = b.raw;
        left = b.leftovers;
      } else {
        rows = db.plan(r, this.qty).ingredients;
      }
      const list = h('ul', { class: 'mat-list' }, rows.map((e) => {
        const items = db.ingItems(e.ref);
        return h('li', null,
          h('span', { class: 'slot slot--item slot--sm', dataset: { tip: items[0] } }, this.icons.el(items[0], { initials: initialsOf(db.name(items[0], lang)) })),
          h('button', { class: 'linkish', type: 'button', onClick: () => this.openItem(items[0]) }, db.ingLabel(e.ref, lang)),
          h('strong', { class: 'mat-n' }, '×', numberFmt(e.count)));
      }));
      const leftEl = left.length ? h('p', { class: 'muted small' }, (lang === 'de' ? 'Übrig: ' : 'Left over: ') + left.map((l) => `${l.count}× ${db.name(l.id, lang)}`).join(', ')) : null;
      const wood = rows.some((e) => /log|planks|stem/.test(String(e.ref))) ? h('p', { class: 'muted small' }, t('materialsNote')) : null;
      fill(wrap,
        h('div', { class: 'mat-head' },
          h('h2', { class: 'block-title' }, `${t('materials')} · ${this.qty}× ${db.name(id, lang)}`),
          h('div', { class: 'seg', role: 'group' },
            h('button', { type: 'button', class: curMode === 'direct' ? 'is-on' : '', 'aria-pressed': curMode === 'direct' ? 'true' : 'false', onClick: () => { LS.set('matMode', 'direct'); draw(); } }, t('materialsDirect')),
            h('button', { type: 'button', class: curMode === 'raw' ? 'is-on' : '', 'aria-pressed': curMode === 'raw' ? 'true' : 'false', onClick: () => { LS.set('matMode', 'raw'); draw(); } }, t('materialsRaw')))),
        list, leftEl, wood);
    };
    void mode;
    draw();
    return wrap;
  }

  useList(id, uses) {
    const db = this.db;
    const lang = getLang();
    const it = db.items[id];
    const blocks = [];
    if (it.fuel) blocks.push(h('p', { class: 'note-line' }, `${t('fuel')}: ${fmtSeconds(it.fuel / 20)} · ${t('burnsItems', { n: numberFmt(it.fuel / 200, 2), count: it.fuel / 200 })}`));
    if (!uses.length && !blocks.length) return h('div', { class: 'empty' }, h('p', null, t('noUse')));
    const groups = new Map();
    for (const u of uses) {
      const k = u.r.station;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(u);
    }
    for (const st of STATIONS) {
      const list = groups.get(st.id);
      if (!list) continue;
      const tex = this.icons.url(TEX_OF[st.id]);
      blocks.push(h('section', { class: 'use-group' },
        h('h2', { class: 'block-title' }, h('img', { src: tex || glyphUrl(GLYPH_OF[st.id]), alt: '', class: tex ? 'hb-tex' : 'hb-glyph' }), stationName(db, st.id), h('span', { class: 'muted' }, ` · ${list.length}`)),
        h('ul', { class: 'use-list' }, list.map(({ r, role }) => {
          const outId = r.out ? r.out.id : db.ingItems(r.b)[0];
          const label = r.t === 'trim' ? `${db.name(db.ingItems(r.tpl)[0], lang)} – ${db.sub(db.ingItems(r.tpl)[0], lang)}` : db.fullName(outId, lang);
          const pc = db.items[outId] && db.items[outId].potion ? db.potionInfo(outId)?.color : null;
          return h('li', null,
            h('button', { class: 'use-row', type: 'button', onClick: () => (r.t === 'trim' ? this.openStation('smithing', r.id) : this.openItem(outId)), dataset: { tip: outId } },
              h('span', { class: 'slot slot--item slot--sm' }, this.icons.el(outId, { initials: initialsOf(db.name(outId, lang)), potionColor: pc })),
              h('span', { class: 'use-name' }, label),
              role !== 'input' ? h('span', { class: 'chip chip--mini' }, t('usedAs.' + role)) : null,
              r.out && r.out.n > 1 ? h('span', { class: 'muted' }, '×' + r.out.n) : null));
        }))));
    }
    return h('div', { class: 'uses' }, blocks);
  }

  // ----------------------------------------------------------------------- Station
  viewStation() {
    const db = this.db;
    const lang = getLang();
    const v = this.view;
    const st = STATION_BY_ID[v.id];
    const all = this.bookOrder(v.id, lang);
    const catOf = (r) => this.categoryOf(r);
    const cats = ['all', ...[...new Set(all.map(catOf))].sort((a, b) => catRank(a) - catRank(b))];
    const filterText = v.filter || '';
    let list = v.cat && v.cat !== 'all' ? all.filter((r) => catOf(r) === v.cat) : all;
    if (filterText.trim()) {
      const ids = new Set(search(this.index, filterText, { lang, limit: 400, minScore: 60 }).results.map((x) => x.id));
      list = list.filter((r) => ids.has(r.out ? r.out.id : db.ingItems(r.tpl)[0]) || (r.in && db.ingItems(r.in).some((i) => ids.has(i))));
    }
    let sel = v.sel ? all.find((r) => r.id === v.sel) : null;
    if (!sel) sel = list[0] || all[0];
    v.sel = sel ? sel.id : null;

    const filterInput = h('input', { id: 'st-filter', class: 'input', type: 'search', value: filterText, placeholder: t('searchStation', { s: stationName(db, v.id) }), 'aria-label': t('searchStation', { s: stationName(db, v.id) }) });
    let to;
    filterInput.addEventListener('input', () => { clearTimeout(to); to = setTimeout(() => { v.filter = filterInput.value; this.render(); const f = this.$('#st-filter'); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }, 160); });
    const book = h('aside', { class: 'book' },
      h('div', { class: 'book-head' },
        h('h2', { class: 'block-title' }, t('recipeBook'), h('span', { class: 'muted' }, ` · ${numberFmt(list.length)}`)),
        filterInput,
        h('div', { class: 'cats', role: 'tablist' }, cats.map((c) => h('button', { type: 'button', role: 'tab', class: `cat${(v.cat || 'all') === c ? ' is-on' : ''}`, 'aria-selected': (v.cat || 'all') === c ? 'true' : 'false', onClick: () => { v.cat = c; v.sel = null; this.render(); } }, c === 'all' ? t('all') : t('cat.' + c))))),
      h('ul', { class: 'book-list' }, list.slice(0, 600).map((r) => this.bookRow(r, r === sel))));

    const sandboxOn = !!v.sandbox;
    const panel = h('section', { class: 'st-panel' },
      h('div', { class: 'st-panel-head' },
        h('h1', { class: 'st-title' }, stationName(db, v.id)),
        h('div', { class: 'seg', role: 'group' },
          h('button', { type: 'button', class: !sandboxOn ? 'is-on' : '', 'aria-pressed': !sandboxOn ? 'true' : 'false', onClick: () => { v.sandbox = false; this.render(); } }, t('sandboxShow')),
          h('button', { type: 'button', class: sandboxOn ? 'is-on' : '', 'aria-pressed': sandboxOn ? 'true' : 'false', onClick: () => { v.sandbox = true; this.prefillSandbox(v.id, sel); this.render(); } }, t('sandbox')))),
      sandboxOn ? this.sandboxPanel(v.id) : (sel ? this.stationSelected(sel, v.id) : h('p', { class: 'empty' }, t('noResults'))));
    void st;
    return h('div', { class: 'station-view' }, this.backBar(), h('div', { class: 'station-layout' }, panel, book));
  }

  categoryOf(r) {
    if (r.station === 'smithing') return r.t === 'trim' ? 'trim' : 'upgrade';
    if (r.station === 'brewing') return r.out.id.startsWith('splash_') ? 'splash' : r.out.id.startsWith('lingering_') ? 'lingering' : 'potions';
    if (r.station === 'stonecutter') return 'blocks';
    if (!['shaped', 'shapeless'].includes(r.t) && r.station === 'crafting' || (r.station === 'inventory' && !['shaped', 'shapeless'].includes(r.t))) return 'special';
    return r.c || 'misc';
  }

  /** Rezeptbuch-Reihenfolge: alphabetisch nach angezeigtem Namen; Braustand Tränke → Wurf → Verweil, Schmiedetisch Aufwerten → Besatz */
  bookOrder(stId, lang) {
    this.bookCache ??= new Map();
    const key = `${stId}|${lang}`;
    if (this.bookCache.has(key)) return this.bookCache.get(key);
    const coll = new Intl.Collator(lang === 'de' ? 'de' : 'en', { numeric: true, sensitivity: 'base' });
    const rank = { potions: 0, splash: 1, lingering: 2, upgrade: 0, trim: 1 };
    const grouped = stId === 'brewing' || stId === 'smithing';
    const rows = this.db.byStation.get(stId).filter((r) => r.t !== 'repair')
      .map((r) => ({ r, name: this.bookName(r, lang), from: this.bookFrom(r, lang) || '', g: grouped ? (rank[this.categoryOf(r)] ?? 9) : 0 }));
    rows.sort((a, b) => a.g - b.g || coll.compare(a.name, b.name) || coll.compare(a.from, b.from));
    const out = rows.map((x) => x.r);
    this.bookCache.set(key, out);
    return out;
  }

  bookName(r, lang) {
    const db = this.db;
    const outId = r.out ? r.out.id : db.ingItems(r.tpl)[0];
    return r.t === 'trim' ? db.sub(outId, lang) : db.fullName(outId, lang);
  }

  bookFrom(r, lang) {
    const db = this.db;
    if (['smelting', 'blasting', 'smoking', 'campfire', 'stonecutting'].includes(r.t)) return db.ingLabel(r.in, lang);
    if (r.t === 'brewing') return `${db.fullName(r.in, lang)} + ${db.ingLabel(r.re, lang)}`;
    return null;
  }

  bookRow(r, selected) {
    const db = this.db;
    const lang = getLang();
    const outId = r.out ? r.out.id : db.ingItems(r.tpl)[0];
    const name = this.bookName(r, lang);
    const pc = db.items[outId] && db.items[outId].potion ? db.potionInfo(outId)?.color : null;
    const from = this.bookFrom(r, lang);
    return h('li', null, h('button', { class: `book-row${selected ? ' is-sel' : ''}`, type: 'button', 'aria-current': selected ? 'true' : null, dataset: { tip: outId },
      onClick: () => { this.view.sel = r.id; this.view.sandbox = false; this.render(); if (matchMedia('(max-width: 899px)').matches) this.$('.st-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
    h('span', { class: 'slot slot--item slot--sm' }, this.icons.el(outId, { initials: initialsOf(db.name(outId, lang)), potionColor: pc })),
    h('span', { class: 'book-name' }, name, from ? h('span', { class: 'book-from' }, '← ', from) : null),
    r.out && r.out.n > 1 ? h('span', { class: 'book-n' }, '×' + r.out.n) : null));
  }

  stationSelected(r, stId) {
    const db = this.db;
    const lang = getLang();
    const card = this.recipeCard(r, { grid: stId === 'inventory' ? 2 : 3 });
    const outId = r.out ? r.out.id : null;
    const qty = outId ? h('div', { class: 'st-qty' }, this.qtyControl(() => this.render())) : null;
    return h('div', { class: 'st-selected' }, qty, card,
      outId ? h('p', null, h('button', { class: 'btn btn--accent', type: 'button', onClick: () => this.openItem(outId) }, `${db.name(outId, lang)} →`)) : null);
  }

  // ----------------------------------------------------------------------- Freies Craften
  sandboxSize(stId) {
    return { crafting: 9, inventory: 4, furnace: 1, blast_furnace: 1, smoker: 1, campfire: 1, stonecutter: 1, smithing: 3, brewing: 2 }[stId];
  }

  prefillSandbox(stId, r) {
    const n = this.sandboxSize(stId);
    const grid = new Array(n).fill(null);
    if (r) {
      const pick = (ref) => (ref == null ? null : this.db.ingItems(ref)[this.tick % this.db.ingItems(ref).length]);
      if (stId === 'crafting' || stId === 'inventory') {
        const lay = this.db.layout(r, stId === 'inventory' ? 2 : 3) || [];
        lay.forEach((ref, i) => { grid[i] = pick(ref); });
      } else if (['furnace', 'blast_furnace', 'smoker', 'campfire', 'stonecutter'].includes(stId)) grid[0] = pick(r.in);
      else if (stId === 'smithing') { grid[0] = pick(r.tpl); grid[1] = pick(r.b); grid[2] = pick(r.a); }
      else if (stId === 'brewing') { grid[0] = r.in; grid[1] = pick(r.re); }
    }
    this.sandbox[stId] = grid;
  }

  sandboxPanel(stId) {
    const db = this.db;
    const lang = getLang();
    if (!this.sandbox[stId]) this.prefillSandbox(stId, null);
    const grid = this.sandbox[stId];
    const ctx = new Ctx(this, { letters: false });
    const setSlot = (i) => (ev) => {
      if (ev) ev.stopPropagation();
      if (grid[i]) { grid[i] = null; this.render(); return; }
      this.pickItem((id) => { grid[i] = id; this.render(); });
    };
    const slots = grid.map((id, i) => (id ? ctx.slot(id, { onClick: setSlot(i), letter: false }) : ctx.slot(null, { onClick: setSlot(i), label: t('pickItem') })));
    let matches = [];
    if (stId === 'crafting' || stId === 'inventory') matches = db.matchCrafting(grid, stId === 'inventory' ? 2 : 3);
    else if (['furnace', 'blast_furnace', 'smoker', 'campfire', 'stonecutter'].includes(stId)) matches = grid[0] ? db.matchSingleInput(stId, grid[0]) : [];
    else if (stId === 'smithing') matches = grid.every(Boolean) ? db.matchSmithing(grid[0], grid[1], grid[2]) : [];
    else if (stId === 'brewing') matches = grid.every(Boolean) ? db.matchBrewing(grid[0], grid[1]) : [];
    const m = matches[0] || null;
    const outSlot = m ? (m.t === 'trim' ? ctx.slot(grid[1], { big: true, letter: false }) : ctx.result(m.out)) : ctx.slot(null, { big: true });
    let layout;
    const arrowEl = arrow();
    if (stId === 'crafting' || stId === 'inventory') {
      const n = stId === 'inventory' ? 2 : 3;
      layout = h('div', { class: 'gui-row' }, h('div', { class: 'gui-grid', style: { '--n': n } }, slots), arrowEl, outSlot);
    } else if (stId === 'smithing') {
      layout = h('div', { class: 'gui-row' }, h('div', { class: 'smith-slots' }, slots), arrowEl, outSlot);
    } else if (stId === 'brewing') {
      layout = h('div', { class: 'gui-row' }, h('div', { class: 'smith-slots' }, slots), arrowEl, outSlot);
    } else {
      layout = h('div', { class: 'gui-row' }, slots[0], arrowEl, outSlot);
    }
    const gui = h('div', { class: `gui gui--sandbox gui--g${stId === 'inventory' ? 2 : 3}` }, h('div', { class: 'gui-title' }, stationTitle(db, stId)), layout);
    const status = m
      ? h('div', { class: 'sb-status sb-status--ok' },
        h('p', null, t('sandboxMatch', { item: m.out ? db.fullName(m.out.id, lang) : db.sub(db.ingItems(m.tpl)[0], lang) })),
        matches.length > 1 ? h('ul', { class: 'sb-more' }, matches.slice(0, 40).map((x) => h('li', null, h('button', { class: 'linkish', type: 'button', onClick: () => x.out && this.openItem(x.out.id) }, x.out ? `${db.fullName(x.out.id, lang)}${x.out.n > 1 ? ' ×' + x.out.n : ''}` : db.sub(db.ingItems(x.tpl)[0], lang))))) : null,
        m.out ? h('button', { class: 'btn btn--accent', type: 'button', onClick: () => this.openItem(m.out.id) }, t('openRecipe')) : null)
      : h('div', { class: 'sb-status' }, h('p', null, grid.some(Boolean) ? t('sandboxNoMatch') : t('sandboxHint')));
    return h('div', { class: 'sandbox' },
      h('div', { class: 'rc-gui' }, gui),
      h('div', { class: 'sb-side' }, status,
        h('button', { class: 'btn btn--ghost', type: 'button', onClick: () => { this.sandbox[stId] = new Array(grid.length).fill(null); this.render(); } }, t('sandboxClear'))));
  }

  pickItem(onPick) {
    const dlg = this.$('#picker');
    const input = dlg.querySelector('#pick-q');
    const list = dlg.querySelector('#pick-list');
    const lang = getLang();
    dlg.querySelector('#pick-title').textContent = t('pickItem');
    dlg.querySelector('#pick-close').textContent = t('close');
    input.placeholder = t('pickPlaceholder');
    input.value = '';
    const draw = () => {
      const q = input.value.trim();
      const ids = q ? search(this.index, q, { lang, limit: 60 }).results.map((r) => r.id)
        : ['oak_planks', 'stick', 'cobblestone', 'iron_ingot', 'gold_ingot', 'diamond', 'coal', 'redstone', 'string', 'leather', 'paper', 'glass', 'white_wool', 'oak_log', 'stone', 'netherite_ingot', 'gunpowder', 'blaze_powder', 'potion.awkward', 'nether_wart'].filter((id) => this.db.items[id]);
      list.replaceChildren(...ids.map((id) => h('li', null, h('button', { class: 'pick-row', type: 'button', onClick: () => { dlg.close(); onPick(id); } },
        h('span', { class: 'slot slot--item slot--sm' }, this.icons.el(id, { initials: initialsOf(this.db.name(id, lang)), potionColor: this.db.potionInfo(id)?.color })),
        h('span', null, this.db.fullName(id, lang))))));
    };
    input.oninput = () => draw();
    draw();
    dlg.showModal();
    input.focus();
  }

  // ======================================================================= Suche
  bind() {
    const q = this.$('#q');
    q.addEventListener('input', () => { clearTimeout(this.sgTimer); this.sgTimer = setTimeout(() => this.suggest(), 90); });
    q.addEventListener('focus', () => { if (q.value.trim()) this.suggest(); });
    q.addEventListener('keydown', (e) => this.suggestKeys(e));
    this.$('#search-form').addEventListener('submit', (e) => { e.preventDefault(); this.runQuery(q.value); });
    document.addEventListener('click', (e) => { if (!e.target.closest('#search-form')) this.closeSuggest(); });
    for (const b of document.querySelectorAll('[data-lang]')) b.addEventListener('click', () => this.setLanguage(b.dataset.lang));
    this.$('#btn-settings').addEventListener('click', () => this.openSettings());
    this.$('#brand').addEventListener('click', (e) => { e.preventDefault(); this.stack = []; this.go({ kind: 'home' }, ''); });
    window.addEventListener('hashchange', () => this.route());
    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
      if (e.key === '/' && !typing) { e.preventDefault(); q.focus(); q.select(); }
      else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && /^[1-9]$/.test(e.key) && !document.querySelector('dialog[open]')) {
        this.openStation(STATIONS[+e.key - 1].id);
      } else if (e.key === 'Escape') this.closeSuggest();
    });
    // Tooltip wie im Spiel
    const tip = this.$('#tip');
    document.addEventListener('pointerover', (e) => {
      if (e.pointerType === 'touch') return;
      const el = e.target.closest('[data-tip]');
      if (!el || !this.db.items[el.dataset.tip]) { tip.hidden = true; return; }
      this.showTip(el, e);
    });
    document.addEventListener('pointermove', (e) => { if (!tip.hidden) this.placeTip(e); });
    document.addEventListener('pointerout', (e) => { if (e.target.closest('[data-tip]') && !e.relatedTarget?.closest?.('[data-tip]')) tip.hidden = true; });
    this.$('#pick-close').addEventListener('click', () => this.$('#picker').close());
    this.$('#settings-close').addEventListener('click', () => this.$('#settings').close());
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); this.installPrompt = e; });
  }

  showTip(el, e) {
    const db = this.db;
    const lang = getLang();
    const id = el.dataset.tip;
    const it = db.items[id];
    const tip = this.$('#tip');
    const lines = [h('p', { class: `tip-name rarity-${it.r || 'common'}` }, db.name(id, lang))];
    const sub = db.sub(id, lang);
    if (sub) lines.push(h('p', { class: 'tip-sub' }, sub));
    const p = db.potionInfo(id);
    if (p) for (const fx of p.effects) lines.push(h('p', { class: fx.cat === 'h' ? 'tip-bad' : 'tip-good' }, `${fx.n[lang === 'de' ? 1 : 0]}${fx.amp ? ' ' + (db.ui['potion.potency.' + fx.amp] || ['', ''])[lang === 'de' ? 1 : 0] : ''}${fx.instant ? '' : ` (${fmtTicks(fx.ticks)})`}`));
    if (el.dataset.multi) lines.push(h('p', { class: 'tip-multi' }, el.dataset.multi));
    lines.push(h('p', { class: 'tip-other' }, lang === 'de' ? it.n[0] : it.n[1]));
    lines.push(h('p', { class: 'tip-id' }, 'minecraft:' + (it.base || id)));
    tip.replaceChildren(...lines);
    tip.hidden = false;
    this.placeTip(e);
  }

  placeTip(e) {
    const tip = this.$('#tip');
    const pad = 14;
    let x = e.clientX + pad, y = e.clientY - 8;
    const r = tip.getBoundingClientRect();
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = innerHeight - r.height - 8;
    tip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  }

  runQuery(raw) {
    const q = this.$('#q');
    q.value = raw;
    const res = search(this.index, raw, { lang: getLang(), limit: 30 });
    if (res.results.length) {
      this.openItem(res.results[0].id, res.qty || null);
      q.blur();
    } else this.suggest();
  }

  suggest() {
    clearTimeout(this.sgTimer);
    const q = this.$('#q');
    const box = this.$('#suggest');
    const raw = q.value;
    // Nur bei aktivem Suchfeld aufklappen (sonst öffnet ein verspäteter Tipp-Timer die Liste nach dem Sprung zum Item erneut)
    if (!raw.trim() || document.activeElement !== q) { this.closeSuggest(); return; }
    const lang = getLang();
    const res = search(this.index, raw, { lang, limit: 12 });
    this.sugg = { res, sel: 0, raw };
    const db = this.db;
    if (!res.results.length) {
      box.replaceChildren(h('p', { class: 'sg-none' }, t('noResults')));
    } else {
      const fuzzy = res.results[0].score < 84;
      fill(box,
        fuzzy ? h('p', { class: 'sg-hint' }, t('didYouMean')) : null,
        h('ul', { id: 'sg-list', role: 'listbox' }, res.results.map((r, i) => {
          const it = db.items[r.id];
          const sts = [...db.stationsFor(r.id)];
          const pc = it.potion ? db.potionInfo(r.id)?.color : null;
          const tag = db.sub(r.id, lang) || db.potionTag(r.id, lang);
          return h('li', { role: 'option', id: 'sg-' + i, 'aria-selected': i === 0 ? 'true' : 'false', class: i === 0 ? 'is-sel' : '' },
            h('button', { type: 'button', class: 'sg-row', tabIndex: -1, onClick: () => { this.openItem(r.id, res.qty || null); q.blur(); } },
              h('span', { class: 'slot slot--item slot--sm' }, this.icons.el(r.id, { initials: initialsOf(db.name(r.id, lang)), potionColor: pc })),
              h('span', { class: 'sg-names' },
                h('span', { class: `sg-name rarity-${it.r || 'common'}` }, db.name(r.id, lang), tag ? h('span', { class: 'sg-sub' }, ' – ' + tag) : null),
                h('span', { class: 'sg-other' }, lang === 'de' ? it.n[0] : it.n[1])),
              h('span', { class: 'sg-st' }, sts.slice(0, 4).map((s) => h('img', { src: this.icons.url(TEX_OF[s]) || glyphUrl(GLYPH_OF[s]), alt: stationName(db, s), title: stationName(db, s) }))),
              res.qty && i === 0 ? h('span', { class: 'chip chip--mini' }, '×' + res.qty) : null));
        })));
    }
    box.hidden = false;
    q.setAttribute('aria-expanded', 'true');
  }

  suggestKeys(e) {
    const box = this.$('#suggest');
    // Enter kurz nach dem Tippen: Vorschläge zur aktuellen Eingabe sofort berechnen, nicht den Treffer von vorhin öffnen
    if (e.key === 'Enter' && this.sugg && this.sugg.raw !== this.$('#q').value) this.suggest();
    if (box.hidden || !this.sugg || !this.sugg.res.results.length) return;
    const n = this.sugg.res.results.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.sugg.sel = (this.sugg.sel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      box.querySelectorAll('li[role=option]').forEach((li, i) => { li.classList.toggle('is-sel', i === this.sugg.sel); li.setAttribute('aria-selected', i === this.sugg.sel ? 'true' : 'false'); });
      this.$('#q').setAttribute('aria-activedescendant', 'sg-' + this.sugg.sel);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = this.sugg.res.results[this.sugg.sel];
      this.openItem(r.id, this.sugg.res.qty || null);
      this.$('#q').blur();
    } else if (e.key === 'Escape') {
      this.closeSuggest();
    }
  }

  closeSuggest() {
    clearTimeout(this.sgTimer);
    const box = this.$('#suggest');
    if (box) box.hidden = true;
    this.$('#q')?.setAttribute('aria-expanded', 'false');
  }

  setLanguage(l) {
    setLang(l);
    LS.set('lang', l);
    try { localStorage.setItem('craftionary.lang', l); } catch { /* egal */ }
    this.renderStatic();
    this.render();
    if (!this.$('#suggest').hidden) this.suggest();
  }

  // ======================================================================= Einstellungen & Texturen
  openSettings(focus = null) {
    const dlg = this.$('#settings');
    this.$('#settings-title').textContent = t('settings');
    this.$('#settings-close').textContent = t('close');
    this.renderSettings();
    dlg.showModal();
    if (focus === 'textures') dlg.querySelector('#tex-section')?.scrollIntoView({ block: 'start' });
  }

  renderSettings() {
    const body = this.$('#settings-body');
    const db = this.db;
    const lang = getLang();
    const mb = Math.round(db.meta.clientSize / 1e6);
    const preview = !!window.CRAFTIONARY_PREVIEW; // Vorschau-Seite: fremde Downloads sind dort gesperrt
    const status = this.icons.available
      ? h('p', { class: 'ok' }, t('texturesOn', { n: numberFmt(this.icons.urls.size), v: this.icons.meta?.version || db.meta.version }))
      : h('p', null, t('texturesOff'));
    const fileInput = h('input', { id: 'tex-file', type: 'file', accept: '.jar,.zip,application/java-archive,application/zip', class: 'visually-hidden' });
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) this.importTextures({ file: fileInput.files[0] }); });
    const progress = h('div', { id: 'tex-progress', class: 'progress', hidden: true }, h('div', { class: 'progress-bar' }), h('p', { class: 'progress-text' }));
    const texSection = h('section', { id: 'tex-section', class: 'set-block' },
      h('h3', null, t('textures')),
      status,
      h('div', { class: 'set-actions' },
        preview ? null : h('button', { class: 'btn btn--accent', type: 'button', onClick: () => this.importTextures({ mojang: true }) }, t('texturesFromMojang', { mb })),
        h('label', { class: `btn${preview ? ' btn--accent' : ''}`, for: 'tex-file' }, t('texturesFromFile')),
        fileInput,
        this.icons.available ? h('button', { class: 'btn btn--ghost', type: 'button', onClick: async () => { await this.icons.clear(); this.renderSettings(); } }, t('texturesRemove')) : null),
      preview ? h('p', { class: 'muted small' }, t('texturesPreview')) : h('p', { class: 'muted small' }, t('texturesMobileData', { mb })),
      h('p', { class: 'muted small' }, t('texturesFileHint', { v: db.meta.version })),
      progress);
    const langSection = h('section', { class: 'set-block' },
      h('h3', null, t('language')),
      h('div', { class: 'seg', role: 'group' },
        ['de', 'en'].map((l) => h('button', { type: 'button', class: lang === l ? 'is-on' : '', 'aria-pressed': lang === l ? 'true' : 'false', onClick: () => { this.setLanguage(l); this.renderSettings(); this.$('#settings-title').textContent = t('settings'); this.$('#settings-close').textContent = t('close'); } }, l === 'de' ? 'Deutsch' : 'English'))));
    const install = this.installPrompt ? h('section', { class: 'set-block' }, h('button', { class: 'btn btn--accent', type: 'button', onClick: async () => { this.installPrompt.prompt(); this.installPrompt = null; this.renderSettings(); } }, t('install'))) : null;
    const about = h('section', { class: 'set-block' },
      h('h3', null, t('about')),
      h('p', null, t('aboutText', { r: numberFmt(db.recipes.length), v: db.meta.version })),
      h('p', { class: 'muted small' }, t('dataLine', { v: db.meta.version, dp: db.meta.dataPack, n: numberFmt(Object.keys(db.items).length), d: new Date(db.meta.built + 'T12:00:00').toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) })),
      h('p', { class: 'muted small' }, t('keys')),
      h('p', { class: 'disclaimer' }, t('disclaimer')));
    fill(body, langSection, texSection, install, about);
  }

  async importTextures(src) {
    const box = this.$('#tex-progress');
    if (!box) return;
    if (this.importing) { this.toast(t('busy')); return; }
    this.importing = true;
    for (const b of this.$('#tex-section').querySelectorAll('button, input')) b.disabled = true;
    box.hidden = false;
    const bar = box.querySelector('.progress-bar');
    const txt = box.querySelector('.progress-text');
    const set = (frac, text) => { bar.style.width = `${Math.round(frac * 100)}%`; txt.textContent = text; };
    try {
      const { importTextures } = await import('./textures.js');
      const res = await importTextures(this.db, src, (stage, a, b) => {
        if (stage === 'download') set(a * 0.5, t('texturesProgressDownload', { p: Math.round(a * 100) }));
        else if (stage === 'unpack') set(0.5, t('texturesProgressUnpack'));
        else if (stage === 'render') set(0.5 + 0.5 * (a / b), t('texturesProgressRender', { n: a, t: b }));
      });
      await this.icons.save(res.icons, { version: res.version, count: res.icons.size, date: new Date().toISOString() });
      set(1, t('texturesDone', { n: numberFmt(res.icons.size) }));
      this.importing = false;
      this.renderSettings();
      // Bei offenem Dialog steht der Status schon dort; ein Toast läge hinter dem Dialog
      if (!this.$('#settings').open) this.toast(t('texturesDone', { n: numberFmt(res.icons.size) }));
    } catch (e) {
      console.error(e);
      const msg = e && e.code === 'WRONG_FILE' ? t('texturesWrongFile', { v: this.db.meta.version })
        : e && e.code === 'BLOCKED' ? t('texturesBlocked') : t('texturesFailed', { e: e.message || String(e) });
      set(0, msg);
      txt.classList.add('err');
      for (const b of this.$('#tex-section')?.querySelectorAll('button, input') || []) b.disabled = false;
    } finally {
      this.importing = false;
    }
  }

  toast(msg, action = null) {
    const el = this.$('#toast');
    fill(el, h('span', null, msg), action ? h('button', { class: 'btn btn--tiny', type: 'button', onClick: action.fn }, action.label) : null);
    el.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { el.hidden = true; }, action ? 12000 : 3500);
  }

  async copy(text, btn) {
    try { await navigator.clipboard.writeText(text); if (btn) { const o = btn.textContent; btn.textContent = t('copied'); setTimeout(() => { btn.textContent = o; }, 1400); } } catch {
      const r = document.createRange();
      const code = btn?.previousElementSibling;
      if (code) { r.selectNodeContents(code); getSelection().removeAllRanges(); getSelection().addRange(r); }
    }
  }

  registerSW() {
    if (!('serviceWorker' in navigator) || !/^https:|^http:\/\/localhost/.test(location.href) || window.CRAFTIONARY_NO_SW) return;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed') {
            if (navigator.serviceWorker.controller) this.toast(t('updateReady'), { label: t('updateNow'), fn: () => { nw.postMessage('skipWaiting'); } });
            else this.toast(t('offlineReady'));
          }
        });
      });
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
    }).catch(() => { /* z. B. in der Vorschau */ });
  }
}

const app = new App();
window.craftionary = app;
app.start();
