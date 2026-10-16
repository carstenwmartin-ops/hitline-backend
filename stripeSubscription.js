// stripeSubscription.js — liest das Laufzeitende eines Stripe-Abos versionsunabhängig.
// Bis API-Version 2025-02-24.acacia steht current_period_end direkt am Abo, ab 2025-03-31.basil nur noch an den
// Positionen (items.data[]). Der Webhook-Endpunkt in Stripe hat eine eigene API-Version (derzeit dahlia), unsere
// Bibliothek (v17) arbeitet mit acacia — deshalb beide Orte lesen.
export const subscriptionPeriodEndMs = (sub) => {
  const direct = sub?.current_period_end;
  const fromItems = (sub?.items?.data || []).map((i) => i?.current_period_end).filter((n) => Number.isFinite(n));
  const seconds = Number.isFinite(direct) ? direct : (fromItems.length ? Math.max(...fromItems) : null);
  return seconds ? seconds * 1000 : null;
};
