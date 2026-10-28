#!/usr/bin/env python3
"""
Craftionary – Datenextraktor
============================

Baut ``data/<version>.json`` ausschließlich aus Mojangs offiziellen Dateien:

* Client-Jar  → Rezepte, Item-Tags, Item-Liste, englische Namen, Musik-/Vorlagen-Infos
* Asset-Index → deutsche Namen (``de_de.json``)
* Server-Jar  → Daten-Generator ``--reports`` (Stapelgröße, Seltenheit, Brennstoffe,
                 Trankdauer-Faktoren). Braucht Java 25 (optional, sonst fehlen diese Felder).
* Spielcode   → Trankwirkungen, Dauer und Farben (``javap`` liest MobEffects/Potions)

Es werden KEINE Texturen oder sonstigen Grafiken in die Ausgabe übernommen.

Aufruf (Beispiel):
    python3 tools/build_data.py --version 26.3 --work ./_mc --java ./_mc/jre25/bin/java

Ohne ``--version`` wird das neueste Release genommen.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"
RESOURCES_URL = "https://resources.download.minecraft.net/{h2}/{h}"
NS = "minecraft:"
HERE = Path(__file__).resolve().parent


# ----------------------------------------------------------------------------
# Hilfsfunktionen
# ----------------------------------------------------------------------------

def log(*a):
    print("[build]", *a, file=sys.stderr)


def strip_ns(s: str) -> str:
    return s[len(NS):] if isinstance(s, str) and s.startswith(NS) else s


def fetch(url: str, dest: Path | None = None, sha1: str | None = None) -> bytes:
    if dest is not None and dest.exists():
        data = dest.read_bytes()
        if sha1 is None or hashlib.sha1(data).hexdigest() == sha1:
            return data
    log("download", url)
    with urllib.request.urlopen(url, timeout=300) as r:
        data = r.read()
    if sha1 is not None and hashlib.sha1(data).hexdigest() != sha1:
        raise SystemExit(f"SHA1 passt nicht: {url}")
    if dest is not None:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
    return data


def jread(z: zipfile.ZipFile, name: str):
    return json.loads(z.read(name).decode("utf-8"))


# ----------------------------------------------------------------------------
# Quellen besorgen
# ----------------------------------------------------------------------------

def get_sources(version: str | None, work: Path):
    work.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(fetch(MANIFEST_URL, work / "version_manifest_v2.json"))
    if version is None:
        version = manifest["latest"]["release"]
    entry = next((v for v in manifest["versions"] if v["id"] == version), None)
    if entry is None:
        raise SystemExit(f"Version {version} nicht im Manifest gefunden")
    vjson = json.loads(fetch(entry["url"], work / f"{version}.json", entry.get("sha1")))
    client = vjson["downloads"]["client"]
    server = vjson["downloads"].get("server")
    client_path = work / f"client-{version}.jar"
    fetch(client["url"], client_path, client["sha1"])
    server_path = None
    if server:
        server_path = work / f"server-{version}.jar"
        fetch(server["url"], server_path, server["sha1"])
    ai = vjson["assetIndex"]
    index = json.loads(fetch(ai["url"], work / f"assetindex-{ai['id']}.json", ai["sha1"]))
    obj = index["objects"].get("minecraft/lang/de_de.json")
    if obj is None:
        raise SystemExit("de_de.json fehlt im Asset-Index")
    h = obj["hash"]
    de_path = work / f"de_de-{version}.json"
    fetch(RESOURCES_URL.format(h2=h[:2], h=h), de_path, h)
    return version, vjson, client_path, server_path, de_path


def run_reports(server_jar: Path, java: str | None, work: Path) -> Path | None:
    """Mojangs Daten-Generator laufen lassen (liefert Item-Komponenten)."""
    out = work / "gen" / "out"
    comp_dir = out / "reports" / "minecraft" / "components" / "item"
    if comp_dir.exists() and any(comp_dir.iterdir()):
        return out / "reports"
    if not java:
        log("WARN: kein Java 25 angegeben – Stapelgröße/Brennstoffe werden übersprungen")
        return None
    (work / "gen").mkdir(parents=True, exist_ok=True)
    cmd = [java, "-Xmx3G", "-DbundlerMainClass=net.minecraft.data.Main", "-jar",
           str(server_jar.resolve()), "--reports", "--output", "out"]
    log("starte Daten-Generator:", " ".join(cmd))
    r = subprocess.run(cmd, cwd=work / "gen", capture_output=True, text=True)
    if r.returncode != 0 or not comp_dir.exists():
        log("WARN: Daten-Generator fehlgeschlagen:\n", r.stdout[-2000:], r.stderr[-2000:])
        return None
    return out / "reports"


# ----------------------------------------------------------------------------
# Spielcode lesen (Trankwirkungen, Farben, Dauer) über javap
# ----------------------------------------------------------------------------

INSN = re.compile(r"^\s*\d+:\s+(\w+)\s*([^/]*?)\s*(?://\s*(.*))?$")


def javap_static(z: zipfile.ZipFile, cls: str) -> list[tuple[str, str, str]]:
    javap = shutil.which("javap")
    if not javap:
        raise RuntimeError("javap nicht gefunden (JDK installieren)")
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / (cls + ".class")
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(z.read(cls + ".class"))
        r = subprocess.run([javap, "-c", "-p", str(p)], capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(r.stderr)
    text = r.stdout
    start = text.find("static {};")
    if start < 0:
        raise RuntimeError(f"kein static-Block in {cls}")
    out = []
    for line in text[start:].splitlines()[2:]:
        m = INSN.match(line)
        if not m:
            if line.strip() == "}":
                break
            continue
        out.append((m.group(1), (m.group(2) or "").strip(), (m.group(3) or "").strip()))
    return out


def int_const(op: str, arg: str, comment: str):
    if op.startswith("iconst_"):
        v = op[len("iconst_"):]
        return -1 if v == "m1" else int(v)
    if op in ("bipush", "sipush"):
        return int(arg)
    if op in ("ldc", "ldc_w") and comment.startswith("int "):
        return int(comment[4:])
    return None


def parse_effects(z: zipfile.ZipFile) -> dict:
    ins = javap_static(z, "net/minecraft/world/effect/MobEffects")
    fields, cur, last_str = {}, None, None
    for op, arg, com in ins:
        if op in ("ldc", "ldc_w") and com.startswith("String "):
            last_str = com[7:]
            continue
        if op == "new" and cur is None and re.search(r"class net/minecraft/world/effect/\w*Effect\w*$", com):
            cls = com.rsplit("/", 1)[-1]
            cur = {"id": last_str, "cls": cls}
            continue
        if cur is not None:
            if "MobEffectCategory." in com and "cat" not in cur:
                cur["cat"] = com.split("MobEffectCategory.")[1].split(":")[0].lower()
                continue
            if "cat" in cur and "color" not in cur:
                v = int_const(op, arg, com)
                if v is not None:
                    cur["color"] = v & 0xFFFFFF
                    continue
            if op == "putstatic":
                fname = com.split("Field ")[1].split(":")[0]
                cur["instant"] = cur["cls"] in ("InstantenousMobEffect", "HealOrHarmMobEffect", "SaturationMobEffect")
                fields[fname] = cur
                cur = None
    return fields


def parse_potion_ids(z: zipfile.ZipFile) -> dict:
    ins = javap_static(z, "net/minecraft/world/item/alchemy/PotionIds")
    ids, last = {}, None
    for op, arg, com in ins:
        if op in ("ldc", "ldc_w") and com.startswith("String "):
            last = com[7:]
        elif op == "putstatic":
            ids[com.split("Field ")[1].split(":")[0]] = last
    return ids


def parse_potions(z: zipfile.ZipFile, effects: dict) -> dict:
    keys = parse_potion_ids(z)
    ins = javap_static(z, "net/minecraft/world/item/alchemy/Potions")
    potions, cur, fx = {}, None, None
    for op, arg, com in ins:
        if op == "getstatic" and "PotionIds." in com:
            cur = {"key": com.split("PotionIds.")[1].split(":")[0], "effects": []}
            continue
        if cur is None:
            continue
        if op in ("ldc", "ldc_w") and com.startswith("String ") and "name" not in cur:
            cur["name"] = com[7:]
            continue
        if op == "getstatic" and "MobEffects." in com:
            fx = {"effect": com.split("MobEffects.")[1].split(":")[0], "ints": []}
            continue
        if fx is not None:
            v = int_const(op, arg, com)
            if v is not None:
                fx["ints"].append(v)
                continue
            if op == "invokespecial" and "MobEffectInstance" in com:
                eff = effects[fx["effect"]]
                dur = fx["ints"][0] if fx["ints"] else 0
                amp = fx["ints"][1] if len(fx["ints"]) > 1 else 0
                cur["effects"].append([eff["id"], dur, amp])
                fx = None
                continue
        if op == "putstatic":
            pid = keys[cur["key"]]
            potions[pid] = {"name": cur["name"], "effects": cur["effects"]}
            cur = None
    return potions


def parse_dye_colors(z: zipfile.ZipFile) -> dict:
    """DyeColor: Name in Kleinbuchstaben → textureDiffuseColor (für Banner, Betten usw.)"""
    ins = javap_static(z, "net/minecraft/world/item/DyeColor")
    out, strings, want = {}, [], None
    for op, arg, com in ins:
        if op in ("ldc", "ldc_w") and com.startswith("String "):
            s = com[7:]
            if s.islower():
                want = s
            continue
        if want is not None:
            v = int_const(op, arg, com)
            if v is not None and (op.startswith("ldc") or op == "sipush"):
                out[want] = v & 0xFFFFFF
                want = None
    return out


def potion_color(effects_list, effects_by_id) -> int | None:
    r = g = b = w = 0
    for eid, _dur, amp in effects_list:
        c = effects_by_id[eid]["color"]
        k = amp + 1
        r += k * ((c >> 16) & 255)
        g += k * ((c >> 8) & 255)
        b += k * (c & 255)
        w += k
    if w == 0:
        return None
    return ((r // w) << 16) | ((g // w) << 8) | (b // w)


# ----------------------------------------------------------------------------
# Hauptbau
# ----------------------------------------------------------------------------

def build(version, vjson, client_path: Path, de_path: Path, reports: Path | None) -> dict:
    z = zipfile.ZipFile(client_path)
    names = set(z.namelist())
    ver_info = json.loads(z.read("version.json"))
    en = jread(z, "assets/minecraft/lang/en_us.json")
    de = json.loads(de_path.read_text("utf-8"))

    def tr(key: str):
        if key in en:
            return [en[key], de.get(key, en[key])]
        return None

    # --- Items -----------------------------------------------------------------
    item_ids = sorted(n[len("assets/minecraft/items/"):-5] for n in names
                      if n.startswith("assets/minecraft/items/") and n.endswith(".json"))
    comps = {}
    if reports:
        cdir = reports / "minecraft" / "components" / "item"
        for iid in item_ids:
            p = cdir / f"{iid}.json"
            if p.exists():
                comps[iid] = json.loads(p.read_text("utf-8"))["components"]

    # Kontext-Provider (Brennstoffzeiten) auflösen
    def ctx_int(ref, fast=False):
        if isinstance(ref, (int, float)):
            return ref
        if isinstance(ref, str):
            path = f"data/minecraft/context_int_provider/{strip_ns(ref)}.json"
            if path not in names:
                path = f"data/minecraft/context_float_provider/{strip_ns(ref)}.json"
            return ctx_int(jread(z, path), fast)
        t = strip_ns(ref.get("type", ""))
        if t == "div":
            return ctx_int(ref["left"], fast) / ctx_int(ref["right"], fast)
        if t == "conditional":
            return ctx_int(ref["on_true"] if fast else ref["on_false"], fast)
        if t == "constant":
            return ref["value"]
        raise ValueError(f"unbekannter Provider {ref}")

    fast_speed = 2.0
    fast_burn_div = 2.0
    try:
        fast_speed = float(ctx_int("minecraft:cooking/speed_default", fast=True))
        fast_burn_div = float(ctx_int("minecraft:cooking/time_coal", fast=False)) / float(ctx_int("minecraft:cooking/time_coal", fast=True))
    except Exception:  # noqa: BLE001
        log("WARN: Ofen-Faktoren nicht lesbar – nehme 2.0")

    jukebox = {}
    for n in names:
        if n.startswith("data/minecraft/jukebox_song/") and n.endswith(".json"):
            j = jread(z, n)
            d = j.get("description", {})
            key = d.get("translate") if isinstance(d, dict) else None
            jukebox[n.rsplit("/", 1)[1][:-5]] = key

    items: dict[str, dict] = {}
    for iid in item_ids:
        c = comps.get(iid, {})
        key = (c.get("minecraft:item_name") or {}).get("translate")
        if not key:
            key = f"item.minecraft.{iid}" if f"item.minecraft.{iid}" in en else f"block.minecraft.{iid}"
        n = tr(key)
        if n is None:
            log("WARN: kein Name für", iid, key)
            n = [iid.replace("_", " ").title()] * 2
        it = {"n": n, "k": key}
        if c:
            s = c.get("minecraft:max_stack_size", 64)
            if s != 64:
                it["s"] = s
            rar = c.get("minecraft:rarity", "common")
            if rar != "common":
                it["r"] = rar
            if "minecraft:max_damage" in c:
                it["dmg"] = c["minecraft:max_damage"]
            cf = c.get("minecraft:cooking_fuel")
            if cf:
                it["fuel"] = int(ctx_int(cf["burn_time"], fast=False))
            bf = c.get("minecraft:brewing_fuel")
            if bf:
                it["bfuel"] = int(ctx_int(bf["uses"]))
            if "minecraft:potion_duration_scale" in c:
                it["pscale"] = c["minecraft:potion_duration_scale"]
            if "minecraft:food" in c:
                it["food"] = 1
            jp = c.get("minecraft:jukebox_playable")
            if jp and jukebox.get(strip_ns(jp)):
                sub = tr(jukebox[strip_ns(jp)])
                if sub:
                    it["sub"] = sub
        if "sub" not in it and tr(key + ".desc"):
            it["sub"] = tr(key + ".desc")
        items[iid] = it

    # --- Tags --------------------------------------------------------------------
    raw_tags = {}
    pre = "data/minecraft/tags/item/"
    for n in names:
        if n.startswith(pre) and n.endswith(".json"):
            raw_tags[n[len(pre):-5]] = jread(z, n)["values"]

    resolved: dict[str, list[str]] = {}

    def resolve(tag: str, stack=()):
        if tag in resolved:
            return resolved[tag]
        if tag in stack:
            raise ValueError("Tag-Zyklus " + " > ".join(stack + (tag,)))
        out = []
        for v in raw_tags.get(tag, []):
            ref = v["id"] if isinstance(v, dict) else v
            if ref.startswith("#"):
                out += resolve(strip_ns(ref[1:]), stack + (tag,))
            else:
                rid = strip_ns(ref)
                if rid in items:
                    out.append(rid)
                elif not (isinstance(v, dict) and v.get("required") is False):
                    log("WARN: Tag", tag, "verweist auf unbekanntes Item", rid)
        seen, uniq = set(), []
        for x in out:
            if x not in seen:
                seen.add(x)
                uniq.append(x)
        resolved[tag] = uniq
        return uniq

    for t in raw_tags:
        resolve(t)

    used_tags: set[str] = set()

    def ing(x):
        """Zutat kompakt: 'id' | '#tag' | [ids]"""
        if isinstance(x, str):
            if x.startswith("#"):
                t = strip_ns(x[1:])
                if t not in resolved:
                    raise ValueError("unbekannter Tag " + t)
                used_tags.add(t)
                return "#" + t
            rid = strip_ns(x)
            if rid not in items:
                raise ValueError("unbekanntes Item " + rid)
            return rid
        if isinstance(x, list):
            vals = [ing(v) for v in x]
            if len(vals) == 1:
                return vals[0]
            flat = []
            for v in vals:
                if isinstance(v, str) and v.startswith("#"):
                    flat += resolved[v[1:]]
                elif isinstance(v, list):
                    flat += v
                else:
                    flat.append(v)
            return flat
        if isinstance(x, dict) and "item" in x:
            return ing(x["item"])
        raise ValueError(f"unbekanntes Zutatenformat {x!r}")

    # --- Tränke & Effekte ---------------------------------------------------------
    effects_by_field = parse_effects(z)
    effects = {}
    for f in effects_by_field.values():
        eid = f["id"]
        effects[eid] = {
            "n": tr(f"effect.minecraft.{eid}") or [eid, eid],
            "color": f["color"],
            "cat": f.get("cat", "neutral")[0],  # b/h/n
        }
        if f["instant"]:
            effects[eid]["instant"] = 1
    potions_raw = parse_potions(z, effects_by_field)
    potions = {}
    for pid, p in potions_raw.items():
        col = potion_color(p["effects"], effects)
        potions[pid] = {"name": p["name"], "fx": p["effects"]}
        if col is not None:
            potions[pid]["color"] = col
    default_potion_color = 0x385DC6  # PotionContents.BASE_POTION_COLOR (-13083194)

    POTION_BASES = ["potion", "splash_potion", "lingering_potion", "tipped_arrow"]
    for base in POTION_BASES:
        if base not in items:
            continue
        items[base]["group"] = 1  # Basis-Item: wird in Suche durch Varianten ersetzt
        for pid, p in potions.items():
            key = f"item.minecraft.{base}.effect.{p['name']}"
            n = tr(key)
            if n is None:
                continue
            vid = f"{base}.{pid}"
            v = {"n": n, "k": key, "base": base, "potion": pid}
            for fld in ("s", "r", "pscale"):
                if fld in items[base]:
                    v[fld] = items[base][fld]
            items[vid] = v

    # --- Vorlagen-Untertitel (Schmiedevorlagen) ----------------------------------------
    recipe_files = sorted(n for n in names if n.startswith("data/minecraft/recipe/") and n.endswith(".json"))
    for n in recipe_files:
        j = jread(z, n)
        if strip_ns(j.get("type", "")) == "smithing_trim":
            tpl = strip_ns(j["template"]) if isinstance(j["template"], str) else None
            pat = strip_ns(j["pattern"]) if isinstance(j.get("pattern"), str) else None
            if tpl in items and pat:
                sub = tr(f"trim_pattern.minecraft.{pat}")
                if sub:
                    items[tpl]["sub"] = sub
    for iid in items:
        if iid.endswith("_upgrade_smithing_template") and "sub" not in items[iid]:
            sub = tr(f"upgrade.minecraft.{iid[:-len('_smithing_template')]}")
            if sub:
                items[iid]["sub"] = sub

    # --- Rezepte ----------------------------------------------------------------------
    recipes = []
    unknown_types = Counter()

    def out(res, default_count=1):
        if not res:
            return None
        rid = strip_ns(res["id"])
        if rid not in items:
            raise ValueError("unbekanntes Ergebnis " + rid)
        o = [rid, res.get("count", default_count)]
        comp = res.get("components") or {}
        pc = comp.get("minecraft:potion_contents")
        if pc and isinstance(pc, dict) and pc.get("potion"):
            vid = f"{rid}.{strip_ns(pc['potion'])}"
            if vid in items:
                o[0] = vid
        ss = comp.get("minecraft:suspicious_stew_effects")
        if ss:
            o.append({"stew": [[strip_ns(e["id"]), e.get("duration", 160)] for e in ss]})
        return o

    for n in recipe_files:
        rid = n[len("data/minecraft/recipe/"):-5]
        j = jread(z, n)
        t = strip_ns(j.get("type", ""))
        base = {"id": rid}
        if j.get("category"):
            base["c"] = j["category"]
        if j.get("group"):
            base["g"] = j["group"]
        try:
            if t == "crafting_shaped":
                pat = j["pattern"]
                w = max(len(r) for r in pat)
                pat = [r.ljust(w) for r in pat]
                key = {k: ing(v) for k, v in j["key"].items()}
                recipes.append({**base, "t": "shaped", "p": pat, "k": key, "o": out(j["result"])})
            elif t == "crafting_shapeless":
                recipes.append({**base, "t": "shapeless", "i": [ing(x) for x in j["ingredients"]], "o": out(j["result"])})
            elif t == "crafting_transmute":
                r = {**base, "t": "transmute", "in": ing(j["input"]), "m": ing(j["material"])}
                mc = j.get("material_count")
                if mc:
                    r["mc"] = [mc.get("min", 1), mc.get("max", mc.get("min", 1))] if isinstance(mc, dict) else [mc, mc]
                if j.get("add_material_count_to_result"):
                    r["add"] = 1
                o = out(j.get("result"))
                if o is None:  # Ergebnis = Eingabe (z. B. Karten kopieren)
                    first = r["in"]
                    if isinstance(first, str) and first.startswith("#"):
                        first = resolved[first[1:]][0]
                    elif isinstance(first, list):
                        first = first[0]
                    o = [first, 1]
                    r["same"] = 1
                r["o"] = o
                recipes.append(r)
            elif t in ("smelting", "blasting", "smoking", "campfire_cooking"):
                ct = j.get("cookingtime", 200)
                eff = ct / fast_speed if t in ("blasting", "smoking") else ct
                recipes.append({**base, "t": {"campfire_cooking": "campfire"}.get(t, t), "in": ing(j["ingredient"]),
                                "o": out(j["result"]), "xp": j.get("experience", 0), "time": eff})
            elif t == "stonecutting":
                recipes.append({**base, "t": "stonecutting", "in": ing(j["ingredient"]), "o": out(j["result"])})
            elif t == "smithing_transform":
                recipes.append({**base, "t": "smithing", "tpl": ing(j["template"]), "b": ing(j["base"]),
                                "a": ing(j["addition"]), "o": out(j["result"])})
            elif t == "smithing_trim":
                recipes.append({**base, "t": "trim", "tpl": ing(j["template"]), "b": ing(j["base"]),
                                "a": ing(j["addition"]), "pat": strip_ns(j.get("pattern", ""))})
            elif t == "brewing":
                inp = j["input"]
                in_item = strip_ns(inp["item"])
                pot = strip_ns(inp.get("potion_contents", {}).get("potions", "water"))
                in_vid = f"{in_item}.{pot}"
                if in_vid not in items:
                    raise ValueError("unbekannter Trank " + in_vid)
                recipes.append({**base, "t": "brewing", "in": in_vid, "re": ing(j["reagent"]["item"]),
                                "o": out(j["output"])})
            elif t == "crafting_dye":
                recipes.append({**base, "t": "dye", "tg": ing(j["target"]), "dye": ing(j["dye"]), "o": out(j["result"])})
            elif t == "crafting_imbue":
                src = strip_ns(j["source"])
                o = out(j["result"])
                # je Trank ein eigenes Rezept (z. B. Pfeil der Heilung)
                for pid in potions:
                    sv, ov = f"{src}.{pid}", f"{o[0]}.{pid}"
                    if sv in items and ov in items:
                        recipes.append({**base, "id": f"{rid}/{pid}", "t": "imbue", "m": ing(j["material"]),
                                        "src": sv, "o": [ov, o[1]]})
            elif t == "crafting_decorated_pot":
                recipes.append({**base, "t": "pot", "back": ing(j["back"]), "left": ing(j["left"]),
                                "right": ing(j["right"]), "front": ing(j["front"]), "o": out(j["result"])})
            elif t == "crafting_special_bannerduplicate":
                b = ing(j["banner"])
                recipes.append({**base, "t": "banner_copy", "b": b, "o": out(j["result"])})
            elif t == "crafting_special_bookcloning":
                recipes.append({**base, "t": "book_copy", "src": ing(j["source"]), "m": ing(j["material"]),
                                "o": out(j["result"])})
            elif t == "crafting_special_firework_rocket":
                recipes.append({**base, "t": "rocket", "shell": ing(j["shell"]), "fuel": ing(j["fuel"]),
                                "star": ing(j["star"]), "o": out(j["result"])})
            elif t == "crafting_special_firework_star":
                recipes.append({**base, "t": "star", "fuel": ing(j["fuel"]), "dye": ing(j["dye"]),
                                "shapes": {k: ing(v) for k, v in j["shapes"].items()},
                                "trail": ing(j["trail"]), "twinkle": ing(j["twinkle"]), "o": out(j["result"])})
            elif t == "crafting_special_firework_star_fade":
                recipes.append({**base, "t": "star_fade", "tg": ing(j["target"]), "dye": ing(j["dye"]),
                                "o": out(j["result"])})
            elif t == "crafting_special_mapextending":
                m = ing(j["map"])
                first = resolved[m[1:]][0] if isinstance(m, str) and m.startswith("#") else m
                recipes.append({**base, "t": "map_extend", "map": m, "m": ing(j["material"]), "o": [first, 1]})
            elif t == "crafting_special_repairitem":
                recipes.append({**base, "t": "repair"})
            elif t == "crafting_special_shielddecoration":
                recipes.append({**base, "t": "shield_deco", "b": ing(j["banner"]), "tg": ing(j["target"]),
                                "o": out(j["result"])})
            else:
                unknown_types[t] += 1
        except Exception as e:  # noqa: BLE001
            raise SystemExit(f"Fehler in Rezept {rid}: {e}")
    if unknown_types:
        log("WARN: unbekannte Rezepttypen:", dict(unknown_types))

    # Tags, die nur indirekt gebraucht werden (Tag in Tag) sind bereits aufgelöst.
    tags = {t: resolved[t] for t in sorted(used_tags)}
    labels = json.loads((HERE / "tag_labels.json").read_text("utf-8"))
    tag_names = {}
    for t, members in tags.items():
        if t in labels:
            tag_names[t] = labels[t]
        elif len(members) == 1:
            tag_names[t] = items[members[0]]["n"]
        else:
            log("WARN: keine Bezeichnung für Tag", t, "– bitte in tools/tag_labels.json ergänzen")
            tag_names[t] = [t.replace("_", " ").title()] * 2

    ui_keys = [
        "container.crafting", "container.furnace", "container.blast_furnace", "container.smoker",
        "container.stonecutter", "container.upgrade", "container.brewing", "container.inventory",
        "block.minecraft.crafting_table", "block.minecraft.furnace", "block.minecraft.blast_furnace",
        "block.minecraft.smoker", "block.minecraft.campfire", "block.minecraft.soul_campfire",
        "block.minecraft.stonecutter", "block.minecraft.smithing_table", "block.minecraft.brewing_stand",
        "block.minecraft.crafter", "effect.none",
        "potion.potency.1", "potion.potency.2", "potion.potency.3", "potion.potency.4", "potion.potency.5",
    ]
    ui = {k: tr(k) for k in ui_keys if tr(k)}

    # Ein Item gilt als „herstellbar“, wenn es Ergebnis eines Rezepts ist
    produced = Counter()
    for r in recipes:
        if r.get("o"):
            produced[r["o"][0]] += 1
    for iid, c in produced.items():
        items[iid]["mk"] = c

    data = {
        "meta": {
            "version": version,
            "built": _dt.date.today().isoformat(),
            "dataPack": ver_info.get("pack_version", {}).get("data_major"),
            "resourcePack": ver_info.get("pack_version", {}).get("resource_major"),
            "clientSha1": vjson["downloads"]["client"]["sha1"],
            "clientUrl": vjson["downloads"]["client"]["url"],
            "clientSize": vjson["downloads"]["client"]["size"],
            "fastSpeed": fast_speed,
            "fastBurnDiv": fast_burn_div,
            "defaultPotionColor": default_potion_color,
            "counts": {"items": len(items), "recipes": len(recipes), "tags": len(tags)},
        },
        "items": items,
        "tags": tags,
        "tagNames": tag_names,
        "ui": ui,
        "recipes": recipes,
        "effects": effects,
        "potions": potions,
        "dyeColors": parse_dye_colors(z),
    }
    return data


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", help="Minecraft-Version (Standard: neuestes Release)")
    ap.add_argument("--work", default="_mc", help="Arbeitsordner für Downloads")
    ap.add_argument("--java", help="Pfad zu Java 25 (für den Daten-Generator)")
    ap.add_argument("--out", default=str(HERE.parent / "data"), help="Zielordner")
    a = ap.parse_args()
    work = Path(a.work)
    version, vjson, client, server, de = get_sources(a.version, work)
    reports = run_reports(server, a.java, work) if server else None
    data = build(version, vjson, client, de, reports)
    outdir = Path(a.out)
    outdir.mkdir(parents=True, exist_ok=True)
    target = outdir / f"{version}.json"
    target.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), "utf-8")
    (outdir / "versions.json").write_text(json.dumps({"default": version, "versions": [version]}, indent=2), "utf-8")
    log("fertig:", target, f"{target.stat().st_size/1024:.0f} KB", data["meta"]["counts"])


if __name__ == "__main__":
    main()
