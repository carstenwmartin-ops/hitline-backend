// legal/index.js — Stand der Kanzlei-Rechtstexte für die Kaufbestätigung.
//
// agb.html / widerruf.html sind unveränderte Kopien der Texte der IT-Recht Kanzlei (Quelle im Frontend-Repo:
// kanzlei/online-shop-agb.html und kanzlei/online-shop-widerrufsbelehrung.html). Sie werden hier als Text in die
// Bestätigungsmail eingefügt, damit der Kunde den Vertragsinhalt inkl. AGB und Widerrufsbelehrung "auf einem
// dauerhaften Datenträger" erhält — in der Fassung zum Kaufzeitpunkt.
// Nach jeder Änderung durch die Kanzlei die HTML-Dateien hier neu einsetzen.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { convert } from 'html-to-text';

const dir = path.dirname(fileURLToPath(import.meta.url));

const load = (file) => {
  const html = fs.readFileSync(path.join(dir, file), 'utf8');
  const stand = (html.match(/Stand:\s*([0-9.]+,\s*[0-9:]+)/) || [])[1] || 'unbekannt';
  // Copyright-Block mit externem Logo entfernen (in Mails nicht sinnvoll); der Hinweis wird als Textzeile ergänzt.
  const body = html.replace(/<div id="itkanzlei_txt_copyright"[\s\S]*<\/body>/, '</body>');
  const inner = (body.match(/<body>([\s\S]*?)<\/body>/) || [, body])[1].trim();
  const text = convert(body, {
    wordwrap: 100,
    selectors: [
      { selector: 'h1', options: { uppercase: true } },
      { selector: 'h2', options: { uppercase: true } },
      { selector: 'a', options: { ignoreHref: false, hideLinkHrefIfSameAsText: true } },
      { selector: 'img', format: 'skip' },
    ],
  });
  return { stand, html: inner, text: text.trim() };
};

export const LEGAL = {
  agb: load('agb.html'),
  widerruf: load('widerruf.html'),
};
