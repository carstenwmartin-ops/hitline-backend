// mail/service.js — Warteschlange für Kaufbestätigungen und Widerrufsbestätigungen.
//
// Ablauf: Ein Kaufeintrag (users/{uid}/purchases/{id}) wird per enqueue() in mailQueue/{key} eingereiht.
// processQueue() versendet seriell (IONOS-Versandgrenzen, siehe mailer.js). Die Warteschlange liegt in
// Firebase, nicht im Speicher: Startet Render neu oder ist der Versand vorübergehend gestört, bleibt die
// Mail erhalten und wird beim nächsten Durchlauf (alle 5 Minuten, sowie beim Start) gesendet.
// Solange der Mailversand nicht konfiguriert ist, bleiben Einträge einfach in der Warteschlange.
//
// Zwei Mailarten teilen sich denselben Kaufeintrag als Datenquelle, schreiben aber in getrennte
// Status-Felder (emailStatus/... vs. withdrawalEmailStatus/...), damit sich Kaufbestätigung und
// Widerrufsbestätigung eines Kaufs nicht gegenseitig überschreiben.
import { sendMail, isMailConfigured, isPermanentMailError } from '../mailer.js';
import { buildPurchaseConfirmation } from './purchaseConfirmation.js';
import { buildWithdrawalConfirmation } from './withdrawalConfirmation.js';

const MAX_ATTEMPTS = 8;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const MAIL_KINDS = {
  purchaseConfirmation: {
    build: buildPurchaseConfirmation,
    statusField: 'emailStatus', sentAtField: 'emailSentAt', messageIdField: 'emailMessageId', errorField: 'emailError',
    label: 'Kaufbestätigung',
    ready: (purchase) => !!purchase,
  },
  withdrawalConfirmation: {
    build: buildWithdrawalConfirmation,
    statusField: 'withdrawalEmailStatus', sentAtField: 'withdrawalEmailSentAt', messageIdField: 'withdrawalEmailMessageId', errorField: 'withdrawalEmailError',
    label: 'Widerrufsbestätigung',
    ready: (purchase) => !!purchase?.withdrawnAt,
  },
};

export const createMailService = (getDb) => {
  let running = false;
  let timer = null;

  const purchaseRef = (db, item) => db.ref(`users/${item.uid}/purchases/${item.purchaseId}`);

  const processItem = async (db, key, item) => {
    const kind = MAIL_KINDS[item.type] || MAIL_KINDS.purchaseConfirmation;
    const ref = purchaseRef(db, item);
    const purchase = (await ref.once('value')).val();
    if (!kind.ready(purchase) || purchase[kind.statusField] === 'sent') { await db.ref(`mailQueue/${key}`).remove(); return; }
    if (!purchase.customerEmail) {
      await ref.update({ [kind.statusField]: 'failed', [kind.errorField]: 'Keine E-Mail-Adresse im Kauf hinterlegt' });
      await db.ref(`mailQueue/${key}`).remove();
      console.error(`❌ ${kind.label} nicht möglich (keine E-Mail): ${key}`);
      return;
    }
    if (!isMailConfigured()) return; // bleibt in der Warteschlange, bis der Versand eingerichtet ist

    try {
      const message = kind.build(purchase);
      const result = await sendMail({ to: purchase.customerEmail, ...message });
      await ref.update({ [kind.statusField]: 'sent', [kind.sentAtField]: Date.now(), [kind.messageIdField]: result.messageId || null, [kind.errorField]: null });
      await db.ref(`mailQueue/${key}`).remove();
      console.log(`✉️ ${kind.label} versendet: ${key} (uid=${item.uid})`);
    } catch (e) {
      const attempts = (item.attempts || 0) + 1;
      const giveUp = isPermanentMailError(e) || attempts >= MAX_ATTEMPTS;
      const reason = String(e?.message || e).slice(0, 300);
      if (giveUp) {
        await ref.update({ [kind.statusField]: 'failed', [kind.errorField]: reason });
        await db.ref(`mailQueue/${key}`).remove();
        console.error(`❌ ${kind.label} endgültig fehlgeschlagen (${key}): ${reason}`);
      } else {
        await db.ref(`mailQueue/${key}`).update({ attempts, lastError: reason, lastAttemptAt: Date.now() });
        console.warn(`⚠️ ${kind.label} später erneut (${key}, Versuch ${attempts}/${MAX_ATTEMPTS}): ${reason}`);
      }
    }
  };

  const processQueue = async () => {
    if (running) return;
    const db = getDb();
    if (!db) return;
    running = true;
    try {
      const items = (await db.ref('mailQueue').once('value')).val() || {};
      for (const [key, item] of Object.entries(items)) {
        await processItem(db, key, item);
      }
    } catch (e) {
      console.error('❌ Mail-Warteschlange:', e.message);
    } finally {
      running = false;
    }
  };

  return {
    /** Kauf- oder Widerrufsbestätigung einreihen; wirft nie (Fehler werden geloggt), damit der Aufrufer nicht daran scheitert. */
    enqueue: async (uid, purchaseId, type = 'purchaseConfirmation') => {
      try {
        const db = getDb();
        if (!db) return;
        const key = type === 'purchaseConfirmation' ? purchaseId : `${type}_${purchaseId}`;
        await db.ref(`mailQueue/${key}`).set({ uid, purchaseId, type, createdAt: Date.now(), attempts: 0 });
        setTimeout(() => { processQueue(); }, 500);
      } catch (e) {
        console.error('❌ Mail einreihen fehlgeschlagen:', e.message);
      }
    },
    processQueue,
    start: () => {
      if (timer) return;
      timer = setInterval(() => { processQueue(); }, SWEEP_INTERVAL_MS);
      setTimeout(() => { processQueue(); }, 20000);
    },
  };
};
