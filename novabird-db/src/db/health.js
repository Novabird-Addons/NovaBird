// Gesundheitsprüfung des Index: wann prüfen, was als „kaputt“ gilt. Reine Funktionen (in Node testbar).

export const CHECK_EVERY_STARTS = 20; // zusätzlich zur Prüfung nach unsauberem Beenden: alle 20 Starts ...
export const CHECK_EVERY_MS = 14 * 86_400_000; // ... oder alle 14 Tage, je nachdem was zuerst eintritt

/**
 * Grund einer Prüfung beim Start oder null.
 * unclean: beim letzten Beenden fehlte die Marke „sauber beendet“ (Absturz, Prozess beendet, Stromausfall)
 * starts: Starts seit der letzten Prüfung (einschließlich diesem); lastCheck: Zeitpunkt der letzten Prüfung (ms, 0 = nie)
 */
export function checkDue({ unclean, starts, lastCheck, now }) {
  if (unclean) return "unclean";
  if (starts >= CHECK_EVERY_STARTS) return "starts";
  if (lastCheck && now - lastCheck > CHECK_EVERY_MS) return "days";
  return null;
}

/** Fehlermeldungen, die auf einen unbrauchbaren Index hindeuten (beschädigt, keine Datenbank, Schema zu neu). */
export function brokenReason(error) {
  const msg = String(error?.message ?? error ?? "");
  if (/neuer als dieses Add-on/i.test(msg)) return "newer";
  // Sqlite.sys.mjs meldet beschädigte Dateien nur mit der Zahl des Fehlercodes: 2152857611 = 0x8052000B = NS_ERROR_FILE_CORRUPTED
  if (/malformed|corrupt|not a database|disk image|NS_ERROR_FILE_CORRUPTED|SQLITE_NOTADB|SQLITE_CORRUPT|0x8052000b|2152857611/i.test(msg)) return "corrupt";
  return null;
}

/** PRAGMA quick_check(1) liefert eine Zeile "ok" oder die erste gefundene Abweichung. */
export function quickCheckOk(rows) {
  return Array.isArray(rows) && rows.length >= 1 && String(rows[0]?.r ?? rows[0]?.[0] ?? "").toLowerCase() === "ok";
}
