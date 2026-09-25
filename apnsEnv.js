// APNs kennt zwei getrennte Server: Production (TestFlight, App Store) und Sandbox (Xcode-Debug-Builds).
// Ein Token gehört immer genau zu einer Umgebung; der falsche Server antwortet mit BadDeviceToken.
// Deshalb: bevorzugte Umgebung zuerst, bei BadDeviceToken einmal die andere versuchen.
export const APNS_HOSTS = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
};

// envValue = process.env.APNS_ENVIRONMENT; nur 'sandbox' dreht die Reihenfolge um, sonst Produktion zuerst.
export const apnsOrder = (envValue) => (envValue === 'sandbox' ? ['sandbox', 'production'] : ['production', 'sandbox']);

export const isBadDeviceToken = (result) => {
  if (!result || result.success) return false;
  if (result.status !== 400) return false;
  try {
    return JSON.parse(result.error || '{}').reason === 'BadDeviceToken';
  } catch (e) {
    return String(result.error || '').includes('BadDeviceToken');
  }
};
