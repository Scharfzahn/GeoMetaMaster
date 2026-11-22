# 🌍 GeoMetaMaster – GeoGuessr-Meta lernen

Spielerische Lern-App für GeoGuessr-Meta (Deutsch, dunkles Design, Handy/Tablet/Desktop). Statisch: `index.html`, `style.css`, `app.js`, `data/cards.json` – kein Build, kein Backend, alle Pfade relativ. Fortschritt liegt im `localStorage`, installierbar als PWA.

**Spielprinzip:** erst raten, dann Feedback mit Merksatz. Falsche Karten kommen schnell wieder (Leitner-System, 5 Fächer: 10 Min · 1 · 3 · 7 · 21 Tage). Runden haben 10 Fragen, danach werden die Fehler wiederholt. Dazu XP, Level, Tages-Streak, 3 Leben pro Runde (abschaltbar), Weltkarte (grau → Bronze → Silber → Gold), tägliche Challenge, Boss-Level je Kategorie, Abzeichen und Statistik.

Rundentypen: Multiple Choice, Land auf der Weltkarte tippen, Bilder/Hinweise Ländern zuordnen, Wahr/Falsch, Vergleich zweier Merkmale.

## Auf GitHub Pages veröffentlichen

1. Auf github.com **New repository** anlegen (z. B. `GeoMetaMaster`, public). Falls du dieses Repo schon hast, weiter bei Schritt 4.
2. Lokal oder per Web-Upload alle Dateien dieses Ordners ins Repo legen (`index.html`, `style.css`, `app.js`, `sw.js`, `manifest.webmanifest`, `data/`, `icons/`, optional `tools/`). Mit Git:
   ```bash
   git init && git add . && git commit -m "GeoMetaMaster"
   git branch -M main
   git remote add origin https://github.com/<DEIN-NAME>/GeoMetaMaster.git
   git push -u origin main
   ```
3. Der Code muss auf dem Branch liegen, den du veröffentlichst (meist `main`). Liegt er auf einem anderen Branch, per Pull Request nach `main` mergen.
4. Im Repo: **Settings → Pages → Build and deployment → Source: „Deploy from a branch“**, Branch `main`, Ordner `/ (root)` → **Save**.
5. Nach ca. 1 Minute ist die App unter `https://<DEIN-NAME>.github.io/GeoMetaMaster/` erreichbar.
6. Auf dem Handy die URL öffnen und **„Zum Startbildschirm hinzufügen“ / „App installieren“** wählen.

Lokal testen: `python3 -m http.server 8000` im Projektordner, dann `http://localhost:8000` öffnen. (Nicht per Doppelklick auf `index.html`, sonst gehen `fetch` und Service Worker nicht.)

**Wichtig bei Updates:** Der Service Worker liefert Dateien aus dem Cache und aktualisiert sie im Hintergrund – neue Karten erscheinen beim übernächsten Start. Änderst du `app.js`/`style.css`/`index.html`, erhöhe `VERSION` in `sw.js`.

## Neue Karten hinzufügen (nur `data/cards.json`)

Neue Karte in `karten` anhängen. Zwei Arten:

**Länderkarte** – Antwort ist ein Land:
```json
{
  "id": "bol-pl-01",
  "kategorie": "bollards",
  "land": "PL",
  "hinweis": "Beschreibung des Merkmals, ohne das Land zu nennen",
  "fokus": "Leitpfosten",
  "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/…/960px-Datei.jpg",
  "bildAlt": "Kurze Bildbeschreibung",
  "source": { "titel": "File:Datei.jpg", "autor": "Name", "lizenz": "CC BY-SA 4.0", "url": "https://commons.wikimedia.org/wiki/File:Datei.jpg" },
  "erklaerung": "Warum das so ist.",
  "merksatz": "Eselsbrücke",
  "ablenker": ["DE", "FR", "SE"],
  "schwierigkeit": 2
}
```
**Fragekarte** – Antwort ist Text (z. B. Sonne, Halbkugel, Generationen):
```json
{ "id": "sun-11", "kategorie": "sun", "frage": "…?", "optionen": ["A", "B", "C", "D"], "richtig": 0,
  "erklaerung": "…", "merksatz": "…", "land": "AU" }
```
Felder: `kategorie` muss in `kategorien` stehen, `land` (optional bei Fragekarten) in `laender`. `image` (optional): URL; ohne Bild zeigt die App `diagram` oder die Beschreibung. `ablenker` (optional) legt falsche Antwort-Länder fest – wichtig, wenn ein Merkmal in mehreren Ländern vorkommt. `modi` (optional) schränkt die Rundentypen ein (`mc`, `tf`, `map`, `compare`, `pairs`). `schwierigkeit` 1–3 ordnet die Lektionen. `wf` (optional): eigene Wahr/Falsch-Aussagen `[{ "aussage": "…", "wahr": true, "hinweis": "…" }]`.

`diagram` zeichnet Bilder ohne Foto:
- `{ "type": "strasse", "verkehr": "rechts|links", "mitte": "yellow-double|yellow-dashed|white-dashed|white-solid|…|none", "rand": "white-solid|white-dashed|yellow-solid", "standstreifen": true }`
- `{ "type": "sonne", "sonne": "N|S|O|W" }` (Kompass mit Mittagssonne und Schatten)
- `{ "type": "karte", "laender": ["DE", "FR"] }` (Weltkarte mit markierten Ländern)

Neue Länder: Eintrag in `laender` (`name`, `flagge`, `aehnlich`). Er muss in `data/world.json` existieren (ISO-3166-Alpha-2, die meisten sind enthalten). Neue Kategorien: Eintrag in `kategorien` (inkl. `abzeichen`).

Prüfen: `node tools/check-cards.mjs` (Struktur) bzw. `node tools/check-cards.mjs --images` (zusätzlich Bild-URLs).

### Bilder von Wikimedia Commons

Schnell per Skript: `node tools/add-image.mjs pla-02 "File:France license plate (EN).png" "Französisches Kennzeichen"` trägt URL, Autor, Lizenz und Quelle ein und prüft, dass das Bild lädt. Vorschläge je Karte (Dateititel bei Commons nachsehen): Kennzeichen-Karten `pla-*` (Suche „license plate Frankreich“ usw.), Leitpfosten `bol-*` (Kategorie „Delineators in …“), Masten `pol-*` (Kategorie „Utility poles in …“), Markierungen `mar-*` (Kategorie „Road markings in …“).

Manuell:

1. Datei auf commons.wikimedia.org suchen, Lizenz prüfen (CC0, CC BY, CC BY-SA, Public Domain).
2. Bild-URL nehmen, z. B. `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Datei.jpg/960px-Datei.jpg` (Rechtsklick auf das Bild → Adresse kopieren; Breite 960 ist ein erlaubter Standardwert, bei kleinen Originalen die Original-URL verwenden).
3. `source` mit Titel, Autor, Lizenz und Dateiseiten-URL ausfüllen. Die App zeigt die Nachweise unter **Profil → Bildnachweise**.
4. Lädt ein Bild nicht, zeigt die App eine Ersatzgrafik mit dem `hinweis`.

## Stand dieser Version – ehrlich

- 131 Karten, 16 Länder (DE, FR, PL, ES, GB, SE, RU, JP, TH, US, MX, BR, AR, ZA, AU, NZ) plus Ablenker-Länder, 13 Kategorien.
- **Noch keine Fotos.** Wikimedia hat die Entwicklungsumgebung gedrosselt (HTTP 429), daher gibt es nur Diagramme (Fahrspuren, Markierungen, Sonne) und Beschreibungen. Es sind bewusst keine ungeprüften Bild-URLs enthalten. Bilder lassen sich wie oben Karte für Karte ergänzen.
- Die Meta-Inhalte sind Community-Wissen nach bestem Wissen und können sich ändern (Google tauscht Kameras/Autos aus). Besonders unsicher: Car-Meta je Land und einige Bollard-/Mast-/Kennzeichen-Details – bitte im Spiel gegenprüfen und `cards.json` korrigieren.
- Weltkarte: Natural Earth (gemeinfrei), vereinfacht; sehr kleine Länder fehlen.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html`, `style.css`, `app.js` | App |
| `data/cards.json` | Kategorien, Länder, Karten |
| `data/world.json` | Weltkarten-Pfade (Natural Earth 110m) |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA / offline |
| `tools/check-cards.mjs` | Prüfskript für die JSON-Datei |

Hinweise zu Wikimedia-Bildern: Sie werden direkt von `upload.wikimedia.org` geladen und vom Service Worker lokal zwischengespeichert.
