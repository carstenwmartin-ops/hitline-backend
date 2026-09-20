// mailer.js — Versand von Transaktionsmails (Kaufbestätigung, später Widerrufsbestätigung) über SMTP.
//
// Zugang über Umgebungsvariablen (bei Render, nie im Repo):
//   SMTP_HOST      (Standard: smtp.ionos.de)
//   SMTP_PORT      (Standard: 587 = STARTTLS; 465 = SSL)
//   SMTP_USER      volle Postfachadresse, z.B. shop@hitlines.de
//   SMTP_PASS      Passwort des Postfachs
//   MAIL_FROM      Absender, MUSS dieselbe Domain wie das Postfach haben (IONOS-Regel seit 01/2024),
//                  z.B. "Hitlines <shop@hitlines.de>"
//   MAIL_REPLY_TO  optional, z.B. carsten.martin@hitlines.de
//   MAIL_BCC       optional, interne Kopie jeder Mail
//   MAIL_MIN_GAP_MS optional, Mindestabstand zwischen zwei Mails (Standard 11000)
//   MAIL_TEST_TO   optional, einmaliger Selbsttest: sendet beim Start eine Beispiel-Bestätigung (danach entfernen)
//
// IONOS begrenzt den Versand (u.a. ca. 10 s Pause zwischen Mails, 200 Empfänger je 5 Minuten,
// in den ersten 5 Tagen eines neuen Pakets 50 Empfänger je 6 Stunden). Deshalb läuft der Versand
// über eine serielle Warteschlange mit Mindestabstand. Auf Render sind SMTP-Ports nur auf bezahlten
// Instanzen erreichbar (Free sperrt 25/465/587).
import nodemailer from 'nodemailer';

const readConfig = () => ({
  host: process.env.SMTP_HOST || 'smtp.ionos.de',
  port: Number(process.env.SMTP_PORT || 587),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.MAIL_FROM || '',
  replyTo: process.env.MAIL_REPLY_TO || '',
  bcc: process.env.MAIL_BCC || '',
});

export const isMailConfigured = () => {
  const c = readConfig();
  return !!(c.user && c.pass && c.from);
};

// Welche Variablen fehlen (nur Namen, nie Werte) — für den Start-Log.
export const missingMailConfig = () => {
  const c = readConfig();
  const missing = [];
  if (!c.user) missing.push('SMTP_USER');
  if (!c.pass) missing.push('SMTP_PASS');
  if (!c.from) missing.push('MAIL_FROM');
  return missing;
};

let transporter = null;
let injectedTransport = null; // nur für Tests

export const __setTransportForTests = (t) => { injectedTransport = t; transporter = null; };

const getTransporter = () => {
  if (injectedTransport) return injectedTransport;
  if (transporter) return transporter;
  const c = readConfig();
  transporter = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.port === 465,
    requireTLS: c.port !== 465,
    auth: { user: c.user, pass: c.pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
  return transporter;
};

const MIN_GAP_MS = () => Number(process.env.MAIL_MIN_GAP_MS || 11000);
let chain = Promise.resolve();
let lastSentAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Sendet eine Mail (serialisiert, mit Mindestabstand). Wirft bei Fehlern.
 * @param {{to:string, subject:string, text:string, html?:string, replyTo?:string, bcc?:string}} message
 * @returns {Promise<{messageId:string, accepted:string[]}>}
 */
export const sendMail = (message) => {
  const run = async () => {
    if (!isMailConfigured() && !injectedTransport) {
      const e = new Error('Mailversand nicht konfiguriert');
      e.notConfigured = true;
      throw e;
    }
    const c = readConfig();
    const wait = Math.max(0, lastSentAt + MIN_GAP_MS() - Date.now());
    if (wait) await sleep(wait);
    try {
      const info = await getTransporter().sendMail({
        from: c.from || 'Hitlines <shop@hitlines.de>',
        to: message.to,
        replyTo: message.replyTo || c.replyTo || undefined,
        bcc: message.bcc ?? (c.bcc || undefined),
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: { 'X-Auto-Response-Suppress': 'OOF, AutoReply' },
      });
      lastSentAt = Date.now();
      return { messageId: info.messageId, accepted: info.accepted || [] };
    } catch (e) {
      lastSentAt = Date.now();
      throw e;
    }
  };
  const job = chain.then(run, run);
  chain = job.catch(() => {});
  return job;
};

// Dauerhafte Fehler (falsches Passwort, ungültiger Empfänger) lohnen keinen Wiederholungsversuch;
// vorübergehende (Zeitüberschreitung, 4xx wie "450 send limit exceeded") schon.
export const isPermanentMailError = (e) => {
  if (e?.notConfigured) return false;
  if (e?.code === 'EAUTH') return true;
  return typeof e?.responseCode === 'number' && e.responseCode >= 500;
};
