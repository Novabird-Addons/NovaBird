// Gemeinsame Bausteine der Sprachpakete.
export const B = "(?<![\\p{L}\\p{N}])"; // Wortanfang (unicode-fähig)
export const E = "(?![\\p{L}\\p{N}])"; // Wortende
export const NAME = "([^\\s,;!?]+@[^\\s,;!?]+|\\p{L}[\\p{L}\\p{N}'’.-]*)";

/** Alternativen-Liste -> Regex-Quelltext, längste zuerst. */
export const alt = (words) => [...words].sort((a, b) => b.length - a.length).join("|");

/**
 * Wortlisten und abgeleitete Bausteine eines Pakets.
 * pack.months, pack.numbers, pack.half, pack.units, pack.slashDates
 */
export function fragments(pack) {
  const MONTH = alt(Object.keys(pack.months));
  const NUM = `\\d{1,3}|${alt(Object.keys(pack.numbers))}${pack.half ? "|" + pack.half : ""}`;
  const UNIT = alt(pack.units.flatMap((u) => u.words));
  const PLURAL = alt(pack.units.flatMap((u) => u.plural ?? []));
  const NUMDATE = pack.slashDates
    ? "\\d{1,2}\\.\\d{1,2}\\.(?:\\d{4}|\\d{2})?|\\d{1,2}\\/\\d{1,2}(?:\\/(?:\\d{4}|\\d{2}))?"
    : "\\d{1,2}\\.\\d{1,2}\\.(?:\\d{4}|\\d{2})?";
  // Tag + Monat ("15 March", "March 15th", "15 de marzo") nur in Paketen mit pack.dayMonth; steht vor dem bloßen Monat
  const DM = pack.dayMonth ? pack.dayMonth(MONTH) : null;
  const MONTH_YEAR = pack.dayMonth ? `(?:${MONTH})(?:\\s+(?:de\\s+)?\\d{4})?` : `(?:${MONTH})(?:\\s+\\d{4})?`;
  const ANCHOR = `(?:${DM ? DM + "|" : ""}${MONTH_YEAR}|${NUMDATE}|\\d{4}-\\d{2}-\\d{2}|(?:19|20)\\d{2})`;
  return { B, E, NAME, MONTH, NUM, UNIT, PLURAL, NUMDATE, ANCHOR };
}
