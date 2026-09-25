// Push-Nachrichten für die öffentliche Mitspielersuche ("Ich suche x Mitspielende").
// Reine Funktionen, damit sie ohne Firebase/APNs testbar sind.

export const ROOM_CODE_RE = /^[A-Z0-9]{4}$/;
export const MIN_PUSH_INTERVAL_MS = 8 * 1000;
export const MAX_PUSHES_PER_ROOM = 12;

export const sanitizePushName = (name) => {
  const clean = String(name ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
  return clean || null;
};

// joined = aktuelle Spielerzahl im Raum (inkl. Host), desired = gewünschte Gesamtzahl.
export const buildJoinPush = ({ lang, name, joined, desired }) => {
  const en = lang === 'en';
  const full = desired > 1 && joined >= desired;
  if (full) {
    return en
      ? { title: 'Hitlines', body: 'Your game can start! Have fun with Hitlines!' }
      : { title: 'Hitlines', body: 'Dein Spiel kann beginnen! Viel Spaß mit Hitlines!' };
  }
  const who = sanitizePushName(name) || (en ? 'Someone' : 'Jemand');
  const count = desired > 1 ? ` (${joined}/${desired})` : '';
  return en
    ? { title: 'Hitlines', body: `${who} joined your game${count}` }
    : { title: 'Hitlines', body: `${who} ist dem Spiel beigetreten${count}` };
};

// meta = { lastPushAt, pushCount } aus roomHosts/{code}
export const canSendRoomPush = (meta, now = Date.now()) => {
  const last = Number(meta?.lastPushAt) || 0;
  const count = Number(meta?.pushCount) || 0;
  if (count >= MAX_PUSHES_PER_ROOM) return false;
  if (now - last < MIN_PUSH_INTERVAL_MS) return false;
  return true;
};
