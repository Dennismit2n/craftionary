# Craftionary

Rezept-Kompendium für **Minecraft Java 26.3** als installierbare Web-App (PWA) für Handy, Tablet und Desktop.
Recipe compendium for **Minecraft Java 26.3** as an installable web app (PWA) for phone, tablet and desktop. *(English below.)*

## Deutsch

### Was es kann

| Bereich | Details |
|---|---|
| Suche | Deutsch und Englisch, verzeiht Tippfehler, Mehrzahl, Umlaute ohne Punkte und Zusammenschreibung („werkbnak“, „Stöcke“, „wodden pickaxe“, „Heiltrank“) |
| Mengen | „16 Fackeln“ rechnet direkt: 4× herstellen, Stückzahl pro Feld, Reste, Brennstoff, Dauer, Erfahrung |
| Stationen | Werkbank (3×3), Inventar (2×2), Ofen, Schmelzofen, Räucherofen, Lagerfeuer, Steinsäge, Schmiedetisch, Braustand |
| Darstellung | Jedes Rezept im Fenster wie im Spiel, mit der Platzierung des Rezeptbuchs (schmale Rezepte mittig) |
| Rezeptbuch | Pro Station alle Rezepte mit Reitern und Filter, dazu „Selbst legen“: Items in die Felder legen, die App sagt, was rauskommt |
| Materialliste | Direkt oder bis zu den Grundstoffen aufgelöst, inklusive Resten |
| Offline | Nach dem ersten Besuch funktioniert alles ohne Netz |

Die Daten (2.087 Rezepte, 1.842 Items inklusive aller Tränke und Pfeile) stammen direkt aus Mojangs offiziellen Spieldateien. Die deutschen Namen kommen aus der offiziellen Sprachdatei `de_de.json`, die Fenstertitel ebenfalls („Handwerk“, „Ausrüstung aufwerten“).

### Original-Texturen

Craftionary liefert **keine** Minecraft-Grafiken mit. Ohne Texturen zeigt die App farbige Buchstaben-Felder mit Legende. Für die Optik wie im Spiel lädst du die Texturen einmal aus deiner eigenen Spielversion:

1. Einstellungen (Zahnrad) → **Original-Texturen**
2. **Von Mojang laden** (rund 41 MB, die offizielle `client.jar`, per SHA-1 geprüft) oder **Datei wählen** und die Jar von deinem Rechner nehmen: `%APPDATA%\.minecraft\versions\26.3\26.3.jar`
3. Die App zeichnet daraus alle Icons so, wie das Spiel sie im Inventar zeigt (Blöcke in 3D, Tränke eingefärbt, Truhen, Banner, Schilde, Köpfe und Statuen). Das dauert einmalig rund eine halbe Minute, auf älteren Handys etwas länger.

Die Icons bleiben nur auf deinem Gerät (IndexedDB) und lassen sich in den Einstellungen wieder entfernen.

### Installieren

| Gerät | So geht's |
|---|---|
| Android (Chrome) | Seite öffnen → Menü ⋮ → **App installieren** |
| iPhone/iPad (Safari) | Seite öffnen → Teilen → **Zum Home-Bildschirm** |
| Windows/macOS (Chrome, Edge) | Installieren-Symbol in der Adressleiste oder Einstellungen → **Als App installieren** |

Die App muss dafür über **https** erreichbar sein, zum Beispiel über GitHub Pages: Den Inhalt von `craftionary-pwa.zip` (bzw. `dist/pwa`) in ein Repository legen und unter *Settings → Pages* den Branch freigeben. Alle Pfade sind relativ, ein Unterordner wie `/craftionary/` funktioniert.

### Selbst bauen

Voraussetzungen: Node.js 20+, Python 3.10+, für den Daten-Generator Java 25.

```bash
npm install
npm test                 # 116 Tests: Suche, Platzierung, Mengen, Brauen, alle Rezepte
npm run build            # → dist/pwa (installierbar) und dist/artifact (Vorschau-Seite)
```

Neue Minecraft-Version einlesen:

```bash
python3 tools/build_data.py --version 26.3 --work ./_mc --java /pfad/zu/java25/bin/java
npm run build
```

Ohne `--version` nimmt das Skript das neueste Release. Es lädt Client- und Server-Jar sowie `de_de.json` von Mojang, lässt den offiziellen Daten-Generator laufen (`--reports`) und liest Trankwirkungen und Farben aus dem Spielcode. Texturen landen dabei nie in den Daten.

### Aufbau

| Pfad | Inhalt |
|---|---|
| `js/search.js` | Fehlertolerante Suche (Normalisierung, Stammformen, Damerau-Levenshtein, Teilwort-Abdeckung, Familien-Reihenfolge) |
| `js/db.js` | Rezeptlogik: Platzierung, Mengenplanung, Brennstoff, Materialliste, „Selbst legen“ |
| `js/textures.js` | Liest die Jar im Browser und zeichnet die Icons nach den Modell- und Item-Definitionen des Spiels |
| `js/app.js`, `js/ui.js` | Oberfläche und Spielfenster |
| `tools/build_data.py` | Datenextraktor |
| `tools/build_app.mjs` | Build mit esbuild, Service Worker und Manifest |
| `icons/` | App-Icons als PNG (eigenes Motiv: 3×3-Raster; neu erzeugen mit `npm i -D sharp`, dann die PNGs löschen und bauen) |
| `dev/` | Prüfseiten für die Icon-Darstellung (brauchen eine lokale Jar unter `dev/jar/client.jar`) |

### Rechtliches

Code: MIT-Lizenz (siehe `LICENSE`). Schriften: Pixelify Sans und Atkinson Hyperlegible Next, beide SIL Open Font License (`fonts/`).
Rezeptdaten und Item-Namen stammen aus Minecraft, © Mojang AB/Microsoft.

**KEIN OFFIZIELLES MINECRAFT-PRODUKT. NICHT VON MOJANG ODER MICROSOFT GENEHMIGT ODER MIT IHNEN VERBUNDEN.**

## English

### Features

| Area | Details |
|---|---|
| Search | English and German, forgives typos, plurals, missing umlauts and compound words |
| Amounts | “16 torches” calculates crafts, items per slot, leftovers, fuel, time and XP |
| Stations | Crafting table (3×3), inventory (2×2), furnace, blast furnace, smoker, campfire, stonecutter, smithing table, brewing stand |
| Display | Every recipe in an in-game style window, placed like the recipe book does |
| Recipe book | All recipes per station with tabs and filter, plus “Place items”: put items in the slots and see what comes out |
| Materials | Direct or broken down to raw materials, including leftovers |
| Offline | Works without a connection after the first visit |

### Original textures

Craftionary ships **no** Minecraft artwork. Without textures it shows lettered slots with a key. For the in-game look, load the textures once from your own game version: Settings → **Original textures** → **Load from Mojang** (about 41 MB, the official `client.jar`, SHA-1 checked) or **Choose file** and pick the jar from your computer. The app renders every icon the way the game draws it in the inventory and keeps them on your device only.

### Install

Open the hosted page (https required, e.g. GitHub Pages) and use **Install app** (Android/desktop Chrome or Edge) or **Add to Home Screen** (iOS Safari).

### Build

```bash
npm install
npm test
npm run build
python3 tools/build_data.py --version 26.3 --work ./_mc --java /path/to/java25/bin/java   # new game version
```

### Legal

Code: MIT license. Fonts: SIL Open Font License. Recipe data and item names come from Minecraft, © Mojang AB/Microsoft.

**NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.**
