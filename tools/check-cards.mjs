// Prüft data/cards.json: Struktur, Länder, Pflichtfelder und (mit --images) ob die Bild-URLs erreichbar sind.
// Aufruf:  node tools/check-cards.mjs            (nur Struktur)
//          node tools/check-cards.mjs --images   (zusätzlich Bild-URLs per Netzwerk prüfen, langsam wegen Wikimedia-Limits)
import fs from 'fs';
const db = JSON.parse(fs.readFileSync(new URL('../data/cards.json', import.meta.url), 'utf8'));
const world = JSON.parse(fs.readFileSync(new URL('../data/world.json', import.meta.url), 'utf8'));
const cats = new Set(db.kategorien.map(k => k.id)), ids = new Set(), worldIds = new Set(world.countries.map(c => c.id));
let errors = 0; const err = m => { errors++; console.error('FEHLER:', m); };
for (const [iso, l] of Object.entries(db.laender)) { if (!worldIds.has(iso)) err(`Land ${iso} fehlt in world.json`); for (const a of l.aehnlich || []) if (!db.laender[a]) err(`${iso}: ähnliches Land ${a} unbekannt`); }
for (const c of db.karten) {
  if (ids.has(c.id)) err('doppelte id ' + c.id); ids.add(c.id);
  if (!cats.has(c.kategorie)) err(`${c.id}: unbekannte Kategorie`);
  if (c.land && !db.laender[c.land]) err(`${c.id}: unbekanntes Land ${c.land}`);
  if (c.optionen ? (typeof c.richtig !== 'number' || !c.frage || c.richtig >= c.optionen.length) : !c.land) err(`${c.id}: braucht land oder frage/optionen/richtig`);
  if (!c.erklaerung || !c.merksatz) err(`${c.id}: erklaerung und merksatz fehlen`);
  if (!c.optionen && !c.hinweis && !c.image && !c.diagram) err(`${c.id}: braucht hinweis, image oder diagram`);
  for (const a of c.ablenker || []) if (!db.laender[a] || a === c.land) err(`${c.id}: ungültiger ablenker ${a}`);
  if (c.image && !(c.source && c.source.lizenz && c.source.url)) err(`${c.id}: Bild braucht source {titel, autor, lizenz, url}`);
}
console.log(`${db.karten.length} Karten, ${Object.keys(db.laender).length} Länder, ${db.kategorien.length} Kategorien.`);
if (process.argv.includes('--images')) {
  for (const c of db.karten.filter(k => k.image)) {
    try { const r = await fetch(c.image, { method: 'HEAD', headers: { 'User-Agent': 'GeoMetaMaster-check/1.0' } }); if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/')) err(`${c.id}: Bild ${r.status}`); }
    catch (e) { err(`${c.id}: ${e.message}`); }
    await new Promise(r => setTimeout(r, 1500));
  }
}
process.exit(errors ? 1 : 0);
