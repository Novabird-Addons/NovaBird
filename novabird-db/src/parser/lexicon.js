// Wortlisten für den Parser. Erweitern ist ausdrücklich erwünscht –
// danach immer die Golden-Tests laufen lassen.

export const MONTHS = {
  januar: 1, jänner: 1, jaenner: 1,
  februar: 2, feber: 2,
  märz: 3, maerz: 3, marz: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9, sept: 9,
  oktober: 10,
  november: 11,
  dezember: 12,
};
export const MONTH_RE = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|");

export const NUMBER_WORDS = {
  ein: 1, eine: 1, einen: 1, einem: 1, einer: 1, eins: 1,
  zwei: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5, sechs: 6, sieben: 7,
  acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12, zwoelf: 12,
  zwanzig: 20, dreißig: 30, dreissig: 30,
};
export const NUM_RE = `\\d{1,3}|${Object.keys(NUMBER_WORDS).join("|")}|halben|halbes|halbe`;

// Einheiten: Stamm -> Einheit. Reihenfolge im RegExp: längste zuerst.
export const UNIT_RE =
  "tagen|tage|tag|wochen|woche|monaten|monate|monats|monat|quartalen|quartale|quartals|quartal|jahren|jahres|jahre|jahr";

export function unitOf(word) {
  const w = word.toLowerCase();
  if (w.startsWith("tag")) return "day";
  if (w.startsWith("woche")) return "week";
  if (w.startsWith("monat")) return "month";
  if (w.startsWith("quartal")) return "quarter";
  if (w.startsWith("jahr")) return "year";
  return null;
}

export function isPluralUnit(word) {
  return /^(tagen|tage|wochen|monaten|monate|quartalen|quartale|jahren|jahre)$/i.test(word);
}

export function numberOf(word) {
  const w = word.toLowerCase();
  if (/^\d+$/.test(w)) return Number(w);
  if (w.startsWith("halb")) return 0.5;
  return NUMBER_WORDS[w] ?? null;
}

export const ATTACHMENT_TYPES = [
  { type: "pdf", re: "pdfs?" },
  { type: "excel", re: "excel|xlsx|xls|csv" },
  { type: "word", re: "word|docx|doc" },
  { type: "image", re: "bildern|bilder|bild|fotos|foto|jpe?g|png|screenshots?" },
  { type: "powerpoint", re: "powerpoint|pptx|ppt" },
  { type: "archive", re: "zip" },
];

export const FOLDERS = [
  { type: "inbox", re: "posteingang|eingang|inbox" },
  { type: "sent", re: "gesendeten|gesendete|gesendet|versendeten|versendete|versandte|postausgang|ausgang" },
  { type: "archives", re: "archiv|archive" },
  { type: "drafts", re: "entwürfen|entwürfe|entwurf|entwuerfe" },
  { type: "trash", re: "papierkorb|gelöschten|gelöschte|geloeschte" },
  { type: "junk", re: "spam|junk" },
];

/** Wörter ohne Suchwert (normalisiert verglichen). */
export const FILLER = new Set(
  `ich du er sie wir ihr suche such suchen sucht finde finden find zeig zeige zeigen
   gib gibt mir mich mein meine meinen meinem meiner alle allen alles alle die der das
   den dem des ein eine einen einem einer mails mail emails email e mails e mail nachricht
   nachrichten bitte und wo wie was welche welcher welches welchen es hat haben habe hab
   über ueber uber zum zur zu im in am an auf für fuer fur von vom mit aus bei nach noch mal
   doch irgendwas irgendeine irgendein etwas wegen betreffend bzgl bezüglich bezueglich thema
   sind ist war waren wurde wurden geschickt gesendet geschrieben bekommen erhalten kam kamen
   schickte schickten so sowie dazu davon darin dort hier da denn dann also oder and und or
   alle sämtliche saemtliche jede jeden jeder irgendwann`
    .split(/\s+/)
    .filter(Boolean),
);

/** Wörter, die nach "von/an/mit" nie ein Name sind. */
export const NOT_A_NAME = new Set([
  ...FILLER,
  "anhang", "anhängen", "anhaenge", "anhänge", "anlage", "anlagen", "stern", "tag",
  "heute", "gestern", "vorgestern", "letzten", "letzte", "letztes", "diesem", "dieser",
  "diesen", "dieses", "diese", "kw", "seit", "bis", "ab",
]);
