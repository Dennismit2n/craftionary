// Craftionary – /give-Befehle
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickEnchants, giveCommand, enchantable, NETHERITE_SET, CHAT_LIMIT } from '../js/commands.js';

const vs = JSON.parse(readFileSync(new URL('../data/versions.json', import.meta.url), 'utf8'));
const data = JSON.parse(readFileSync(new URL(`../data/${vs.default}.json`, import.meta.url), 'utf8'));
const ench = JSON.parse(readFileSync(new URL(`../data/enchantments-${vs.default}.json`, import.meta.url), 'utf8'));
const asMap = (list) => Object.fromEntries(list);

test('Schlichter Befehl und Menge', () => {
  assert.equal(giveCommand('torch', data.items.torch), '/give @s torch');
  assert.equal(giveCommand('torch', data.items.torch, { count: 16 }), '/give @s torch 16');
});

test('Trank bekommt seinen Inhalt mit', () => {
  assert.equal(giveCommand('potion.night_vision', data.items['potion.night_vision']), '/give @s potion[potion_contents={potion:"night_vision"}]');
});

test('Netherite-Schwert, Spiel-Maximum: Schärfe statt Bann/Heilige Macht', () => {
  const m = asMap(pickEnchants(ench, 'netherite_sword'));
  assert.deepEqual(m, { mending: 1, unbreaking: 3, sharpness: 5, fire_aspect: 2, knockback: 2, looting: 3, sweeping_edge: 3 });
  assert.equal(giveCommand('netherite_sword', data.items.netherite_sword, { enchants: pickEnchants(ench, 'netherite_sword') }),
    '/give @s netherite_sword[enchantments={mending:1,unbreaking:3,sharpness:5,fire_aspect:2,knockback:2,looting:3,sweeping_edge:3}]');
});

test('Stiefel: Spiel-Maximum nimmt Tiefenstreicher, übertrieben beide (Eisläufer gedeckelt)', () => {
  const max = asMap(pickEnchants(ench, 'netherite_boots'));
  assert.equal(max.depth_strider, 3);
  assert.equal(max.frost_walker, undefined);
  assert.equal(max.protection, 4);
  assert.equal(max.fire_protection, undefined);
  const op = asMap(pickEnchants(ench, 'netherite_boots', { mode: 'op' }));
  assert.equal(op.depth_strider, 255);
  assert.equal(op.frost_walker, 2);
  assert.equal(op.protection, 255);
  assert.equal(op.blast_protection, 255);
  assert.equal(op.mending, 1);
});

test('Werkzeuge: Glück oder Behutsamkeit, nie beides', () => {
  const f = asMap(pickEnchants(ench, 'netherite_pickaxe'));
  const s = asMap(pickEnchants(ench, 'netherite_pickaxe', { mining: 'silk_touch' }));
  assert.deepEqual(f, { mending: 1, unbreaking: 3, efficiency: 5, fortune: 3 });
  assert.deepEqual(s, { mending: 1, unbreaking: 3, efficiency: 5, silk_touch: 1 });
  assert.equal(asMap(pickEnchants(ench, 'netherite_pickaxe', { mode: 'op', mining: 'silk_touch' })).fortune, undefined);
});

test('Dreizack: Treue und Entladung statt Sog', () => {
  const m = asMap(pickEnchants(ench, 'trident'));
  assert.equal(m.loyalty, 3);
  assert.equal(m.channeling, 1);
  assert.equal(m.riptide, undefined);
  assert.equal(asMap(pickEnchants(ench, 'trident', { mode: 'op' })).riptide, undefined);
});

test('Spiel-Maximum enthält nie zwei unverträgliche Verzauberungen', () => {
  for (const id of Object.keys(data.items)) {
    for (const mining of ['fortune', 'silk_touch']) {
      const ks = pickEnchants(ench, id, { mining }).map(([k]) => k);
      for (const a of ks) for (const b of ks) {
        const ea = ench.enchantments[a];
        assert.ok(a === b || !(ea.excl && ench.sets[ea.excl].includes(b)), `${id}: ${a} + ${b}`);
      }
    }
  }
});

test(`Jeder Befehl passt in den Chat (≤ ${CHAT_LIMIT} Zeichen)`, () => {
  for (const [id, it] of Object.entries(data.items)) {
    for (const mode of ['max', 'op']) for (const mining of ['fortune', 'silk_touch']) {
      const cmd = giveCommand(id, it, { count: 64, enchants: pickEnchants(ench, id, { mode, mining }) });
      assert.ok(cmd.length <= CHAT_LIMIT, `${id} (${mode}, ${mining}): ${cmd.length} Zeichen`);
    }
  }
});

test('Netherite-Set: alle zehn Teile gibt es und alle sind verzauberbar', () => {
  for (const id of NETHERITE_SET) {
    assert.ok(data.items[id], id);
    assert.ok(enchantable(ench, id).length >= 4, id);
  }
});
