// consent.js — Zustimmung zum sofortigen Beginn vor Ablauf der Widerrufsfrist (Nachweis).
//
// Der Kaufdialog (Web) fordert ein Häkchen. Damit das Widerrufsrecht bei digitalen Inhalten wirksam
// erlöschen bzw. beim Abo der Wertersatz geschuldet sein kann, wird die Zustimmung SERVERSEITIG
// festgehalten: Zeitpunkt, Version und Wortlaut des Textes, den der Kunde gesehen hat.
//
// WICHTIG: Ändert sich der Text im Kaufdialog (src/i18n/locales/*.json, buyCoins.withdrawalConsent),
// hier eine NEUE Version anlegen (nie eine bestehende ändern) und src/data/purchaseConsent.js im
// Frontend anpassen. Alte Versionen bleiben als Beleg für frühere Käufe bestehen.
export const CONSENT_TEXTS = {
  v1: 'Ich verlange ausdrücklich, dass mit der Ausführung vor Ablauf der Widerrufsfrist begonnen wird, und weiß, dass ich damit mein Widerrufsrecht verliere.',
};

/** @returns {{givenAt:number, version:string, text:string}|null} null = Zustimmung fehlt oder Version unbekannt */
export const validateConsent = (body) => {
  if (body?.consent !== true) return null;
  const version = body.consentVersion;
  const text = CONSENT_TEXTS[version];
  if (!text) return null;
  return { givenAt: Date.now(), version, text };
};
