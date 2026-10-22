// firebaseKey.js — macht eine externe ID zu einem gültigen Realtime-Database-Schlüssel.
// Firebase verbietet . # $ [ ] / in Schlüsselnamen. Google-Play-Bestell-IDs sehen aus wie "GPA.3364-9528-3263-65051"
// und ließen deshalb das Gutschreiben eines Android-Kaufs scheitern (Webhook antwortete 500). Apple- und
// Stripe-IDs enthalten keine dieser Zeichen und bleiben unverändert — bestehende Einträge bleiben also gültig.
export const fbKey = (id) => String(id ?? '').replace(/[.#$\[\]/]/g, '_');
