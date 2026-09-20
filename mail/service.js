// mail/service.js — Warteschlange für Kaufbestätigungen.
//
// Ablauf: Der Stripe-Webhook legt einen Kaufeintrag (users/{uid}/purchases/{id}) an und reiht die Mail über
// enqueue() in mailQueue/{id} ein. processQueue() versendet sie seriell (IONOS-Versandgrenzen, siehe mailer.js).
// Die Warteschlange liegt in Firebase, nicht im Speicher: Startet Render neu oder ist der Versand vorübergehend
// gestört, bleibt die Mail erhalten und wird beim nächsten Durchlauf (alle 5 Minuten, sowie beim Start) gesendet.
// Solange der Mailversand nicht konfiguriert ist, bleiben Einträge einfach in der Warteschlange.
import { sendMail, isMailConfigured, isPermanentMailError } from '../mailer.js';
import { buildPurchaseConfirmation } from './purchaseConfirmation.js';

const MAX_ATTEMPTS = 8;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export const createMailService = (getDb) => {
  let running = false;
  let timer = null;

  const purchaseRef = (db, item) => db.ref(`users/${item.uid}/purchases/${item.purchaseId}`);

  const processItem = async (db, key, item) => {
    const ref = purchaseRef(db, item);
    const purchase = (await ref.once('value')).val();
    if (!purchase || purchase.emailStatus === 'sent') { await db.ref(`mailQueue/${key}`).remove(); return; }
    if (!purchase.customerEmail) {
      await ref.update({ emailStatus: 'failed', emailError: 'Keine E-Mail-Adresse im Kauf hinterlegt' });
      await db.ref(`mailQueue/${key}`).remove();
      console.error(`❌ Kaufbestätigung nicht möglich (keine E-Mail): ${key}`);
      return;
    }
    if (!isMailConfigured()) return; // bleibt in der Warteschlange, bis der Versand eingerichtet ist

    try {
      const message = buildPurchaseConfirmation(purchase);
      const result = await sendMail({ to: purchase.customerEmail, ...message });
      await ref.update({ emailStatus: 'sent', emailSentAt: Date.now(), emailMessageId: result.messageId || null, emailError: null });
      await db.ref(`mailQueue/${key}`).remove();
      console.log(`✉️ Kaufbestätigung versendet: ${key} (uid=${item.uid})`);
    } catch (e) {
      const attempts = (item.attempts || 0) + 1;
      const giveUp = isPermanentMailError(e) || attempts >= MAX_ATTEMPTS;
      const reason = String(e?.message || e).slice(0, 300);
      if (giveUp) {
        await ref.update({ emailStatus: 'failed', emailError: reason });
        await db.ref(`mailQueue/${key}`).remove();
        console.error(`❌ Kaufbestätigung endgültig fehlgeschlagen (${key}): ${reason}`);
      } else {
        await db.ref(`mailQueue/${key}`).update({ attempts, lastError: reason, lastAttemptAt: Date.now() });
        console.warn(`⚠️ Kaufbestätigung später erneut (${key}, Versuch ${attempts}/${MAX_ATTEMPTS}): ${reason}`);
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
    /** Kaufbestätigung einreihen; wirft nie (Fehler werden geloggt), damit der Webhook nicht daran scheitert. */
    enqueue: async (uid, purchaseId) => {
      try {
        const db = getDb();
        if (!db) return;
        await db.ref(`mailQueue/${purchaseId}`).set({ uid, purchaseId, type: 'purchaseConfirmation', createdAt: Date.now(), attempts: 0 });
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
