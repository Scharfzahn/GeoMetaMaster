// Hängt ein Wikimedia-Commons-Bild an eine Karte in data/cards.json an (URL, Autor, Lizenz, Quelle) und prüft, dass die URL lädt.
// Aufruf:  node tools/add-image.mjs <karten-id> "File:Dateiname.jpg" ["Alt-Text"]
// Beispiel: node tools/add-image.mjs pla-02 "File:France license plate (EN).png" "Französisches Kennzeichen"
// Braucht Node 18+ und Internet. Bei HTTP 429 einfach später erneut versuchen.
import fs from 'fs';
const [, , id, file, alt] = process.argv;
if (!id || !file || !file.startsWith('File:')) { console.error('Aufruf: node tools/add-image.mjs <karten-id> "File:Name.jpg" ["Alt-Text"]'); process.exit(1); }
const path = new URL('../data/cards.json', import.meta.url);
const db = JSON.parse(fs.readFileSync(path, 'utf8'));
const card = db.karten.find(k => k.id === id);
if (!card) { console.error('Karte nicht gefunden:', id); process.exit(1); }
const H = { 'User-Agent': 'GeoMetaMaster-tools/1.0 (educational static site)' };
const api = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ action: 'query', format: 'json', titles: file, prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiurlwidth: '960' });
const j = await (await fetch(api, { headers: H })).json();
const ii = Object.values(j.query.pages)[0].imageinfo?.[0];
if (!ii) { console.error('Datei nicht gefunden:', file); process.exit(1); }
const strip = s => (s || '').replace(/<[^>]+>/g, '').trim();
const m = ii.extmetadata || {};
const url = (ii.thumburl || ii.url).split('?')[0].replace('https://thumb.wikimedia.org/', 'https://upload.wikimedia.org/');
const r = await fetch(url, { headers: H });
if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/')) { console.error('Bild lädt nicht:', r.status, url); process.exit(1); }
card.image = url; card.bildAlt = alt || card.bildAlt || card.fokus || '';
card.source = { titel: file, autor: strip(m.Artist?.value).slice(0, 100) || 'Unbekannt', lizenz: strip(m.LicenseShortName?.value) || 'siehe Dateiseite', url: ii.descriptionurl };
fs.writeFileSync(path, JSON.stringify(db, null, 1));
console.log('OK', id, '←', url, '·', card.source.lizenz);
