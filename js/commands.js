// Craftionary – /give-Befehle: schlicht, mit bester Verzauberung (Spiel-Maximum) oder übertrieben (Stufe 255)
// Kurzform ohne „minecraft:“, damit auch lange Befehle unter die 256 Zeichen des Chats passen.

export const NETHERITE_SET = ['netherite_helmet', 'netherite_chestplate', 'netherite_leggings', 'netherite_boots',
  'netherite_sword', 'netherite_spear', 'netherite_pickaxe', 'netherite_axe', 'netherite_shovel', 'netherite_hoe'];
export const CHAT_LIMIT = 256;

// Spiel-Maximum: diese gewinnen zuerst, Gegenspieler aus derselben Ausschluss-Gruppe fallen dann weg
const PRIORITY = ['mending', 'unbreaking', 'protection', 'sharpness', 'impaling', 'density', 'efficiency', 'depth_strider', 'loyalty', 'channeling', 'multishot'];
// Übertrieben: Stufen, die über dem Maximum nur Ärger machen (Eisläufer friert sonst Hunderte Blöcke ein, Köder fängt nichts mehr)
const OP_CAP = { frost_walker: 2, lure: 3 };
const OP_LEVEL = 255;

function conflicts(ench, a, b) {
  const ea = ench.enchantments[a], eb = ench.enchantments[b];
  const inSet = (e, other) => !!(e.excl && ench.sets[e.excl] && ench.sets[e.excl].includes(other));
  return a !== b && (inSet(ea, b) || inSet(eb, a));
}

/** Verzauberungen, die auf das Item passen (ohne Flüche) */
export function enchantable(ench, id) {
  if (!ench) return [];
  return Object.keys(ench.enchantments).filter((k) => !ench.enchantments[k].curse && ench.enchantments[k].items.includes(id));
}

/**
 * Verzauberungen für ein Item als [[id, Stufe], …].
 * mode: 'max' (wie im Spiel möglich) oder 'op' (Stufe 255, auch Unverträgliches zusammen); mining: 'fortune' oder 'silk_touch'
 */
export function pickEnchants(ench, id, { mode = 'max', mining = 'fortune' } = {}) {
  let cands = enchantable(ench, id);
  const other = mining === 'silk_touch' ? 'fortune' : 'silk_touch';
  cands = cands.filter((k) => k !== other);
  if (mode === 'op') {
    // Sog verhindert das Werfen außerhalb von Wasser – mit Treue zusammen wäre der Dreizack an Land nutzlos
    if (cands.includes('loyalty')) cands = cands.filter((k) => k !== 'riptide');
    return cands.map((k) => {
      const max = ench.enchantments[k].max;
      return [k, max === 1 ? 1 : Math.min(OP_CAP[k] ?? OP_LEVEL, OP_LEVEL)];
    });
  }
  const rank = (k) => { const i = PRIORITY.indexOf(k); return i < 0 ? PRIORITY.length : i; };
  cands.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const chosen = [];
  for (const k of cands) if (!chosen.some((c) => conflicts(ench, c, k))) chosen.push(k);
  return chosen.map((k) => [k, ench.enchantments[k].max]);
}

/** Fertiger Befehl für den Chat */
export function giveCommand(id, item, { count = 1, enchants = null } = {}) {
  const comps = [];
  if (item && item.potion) comps.push(`potion_contents={potion:"${item.potion}"}`);
  if (enchants && enchants.length) comps.push(`enchantments={${enchants.map(([k, l]) => `${k}:${l}`).join(',')}}`);
  const base = (item && item.base) || id;
  return `/give @s ${base}${comps.length ? `[${comps.join(',')}]` : ''}${count > 1 ? ' ' + count : ''}`;
}
