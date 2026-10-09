// Sprachpaket Deutsch (Verhalten wie der bisherige Parser; Golden-Tests in tests/parser.cases.json).
import { ATTACHMENT_TYPES, FILLER, FOLDERS, MONTHS, NUMBER_WORDS } from "../lexicon.js";
import { B, E } from "./common.js";

export default {
  code: "de",
  months: MONTHS,
  numbers: NUMBER_WORDS,
  half: "halben|halbes|halbe",
  slashDates: false,
  units: [
    { unit: "day", words: ["tagen", "tage", "tag"], plural: ["tagen", "tage"] },
    { unit: "week", words: ["wochen", "woche"], plural: ["wochen"] },
    { unit: "month", words: ["monaten", "monate", "monats", "monat"], plural: ["monaten", "monate"] },
    { unit: "quarter", words: ["quartalen", "quartale", "quartals", "quartal"], plural: ["quartalen", "quartale"] },
    { unit: "year", words: ["jahren", "jahres", "jahre", "jahr"], plural: ["jahren", "jahre"] },
  ],
  attachmentTypes: ATTACHMENT_TYPES,
  folders: FOLDERS,
  filler: FILLER,
  notAName: [
    "anhang", "anhängen", "anhaenge", "anhänge", "anlage", "anlagen", "stern", "tag",
    "heute", "gestern", "vorgestern", "letzten", "letzte", "letztes", "diesem", "dieser",
    "diesen", "dieses", "diese", "kw", "seit", "bis", "ab",
  ],
  orWords: ["oder"],
  notWords: ["ohne", "nicht", "außer", "ausser", "kein", "keine"],
  stemRules: [["ungen", "ung"], ["heiten", "heit"], ["keiten", "keit"], ["innen", "in"], ["en", ""], ["e", ""], ["s", ""]],
  ops: {
    from: ["von"], to: ["an"], cc: [], with: ["mit"], subject: ["betreff"], attachment: ["anhang", "anh"],
    text: ["text"], is: ["ist"], tag: ["tag"], folder: ["ordner"], since: ["seit", "ab"], until: ["bis"], date: ["datum"],
  },
  vals: {
    meFrom: ["mir", "ich"], meTo: ["mich", "mir"], no: ["nein", "ohne"], unread: ["ungelesen"], read: ["gelesen"], flagged: ["markiert", "stern"],
  },
  relDays: { heute: 0, gestern: -1, vorgestern: -2 },
  /** Muster; Reihenfolge der Gruppen wie in den gemeinsamen Handlern (parseQuery.js). */
  patterns(f) {
    const { NUM, UNIT, ANCHOR, MONTH, NAME } = f;
    const PRE = "(?:(?:aus|in|innerhalb|während|waehrend|von|vom|seit|im\\s+laufe)\\s+)?(?:den|der|dem|des|die)?\\s*";
    const LAST = "(?:letzten|letzte|letztes|letzter|vergangenen|vergangene|vergangenes|vorigen|vorige|voriges|vorheriger|vorherigen)";
    const THIS = "(?:diesen|diese|dieses|diesem|dieser|laufenden|laufende|laufendes|aktuellen|aktuelle|aktuelles)";
    const ATT = "(?:anhang|anhängen|anhänge|anhaengen|anhaenge|anlagen?|attachments?)";
    return {
      dates: {
        between: `${B}zwischen\\s+(${ANCHOR})\\s+und\\s+(${ANCHOR})${E}`,
        range: `${B}(?:vom|von|ab)?\\s*(${ANCHOR})\\s*(?:bis(?:\\s+zum)?|-|–)\\s*(${ANCHOR})${E}`,
        lastN: `${B}${PRE}${LAST}\\s+(${NUM})\\s+(${UNIT})${E}`,
        sinceN: `${B}seit\\s+(${NUM})\\s+(${UNIT})${E}`,
        agoN: `${B}vor\\s+(${NUM})\\s+(${UNIT})${E}`,
        lastUnit: `${B}${PRE}${LAST}\\s+(${UNIT})${E}`,
        thisUnit: `${B}(?:(?:in|aus|von)\\s+)?${THIS}\\s+(${UNIT})${E}`,
        relDay: `${B}(?:von\\s+|seit\\s+)?(heute|gestern|vorgestern)${E}`,
        week: `${B}(?:in\\s+der\\s+|aus\\s+der\\s+)?(?:kw|kalenderwoche)\\s*(\\d{1,2})(?:\\s*[/.]?\\s*((?:19|20)\\d{2}))?${E}`,
        since: `${B}(?:seit|ab)\\s+(?:dem\\s+|anfang\\s+)?(${ANCHOR})${E}`,
        until: `${B}bis\\s+(?:zum\\s+|ende\\s+)?(${ANCHOR})${E}`,
        monthIn: `${B}(?:(?:im|in|aus\\s+dem|vom|von|aus)\\s+(?:monat\\s+)?(${MONTH})(?:\\s+((?:19|20)\\d{2}))?|(${MONTH})\\s+((?:19|20)\\d{2}))${E}`,
        onDate: `${B}(?:am\\s+|vom\\s+)?(${f.NUMDATE}|\\d{4}-\\d{2}-\\d{2})(?![\\p{L}\\p{N}])`,
        year: `${B}(?:(?:im\\s+jahr|aus|in|von)\\s+)?((?:19|20)\\d{2})${E}`,
      },
      attach: {
        without: `${B}ohne\\s+(?:einen\\s+|eine\\s+)?(?:anhang|anhänge|anhaenge|anlagen?|attachments?)${E}`,
        with: `${B}(?:mit|inkl\\.?|inklusive|samt)\\s+(?:dem\\s+|einem\\s+|den\\s+)?${ATT}${E}`,
        type: (tre) => `${B}(?:(?:als|mit|im|in|per)\\s+)?(?:einem\\s+|einer\\s+|einen\\s+)?(?:${tre})(?:-?(?:anhang|anhängen|anhänge|datei|dateien|dokument|dokumenten))?(?:-(?=\\p{L})|(?![\\p{L}\\p{N}]))`,
      },
      status: {
        unread: `${B}(?:ungelesenen|ungelesene|ungelesener|ungelesenes|ungelesen|nicht\\s+gelesen(?:e|en)?)${E}`,
        read: `${B}(?:bereits\\s+)?(?:gelesenen|gelesene|gelesen)${E}`,
        flagged: `${B}(?:markierten|markierte|markiert|mit\\s+stern|mit\\s+sternchen)${E}`,
        tag: `${B}(?:mit\\s+(?:dem\\s+)?)?(?:schlagwort|tag)\\s+("[^"]+"|\\S+)`,
      },
      persons: {
        fromMe: `${B}von\\s+mir${E}`,
        toMe: `${B}an\\s+(?:mich|mir)${E}`,
        iSent: `${B}(?:die|was|welche|den|das)?\\s*ich\\s+(?:an\\s+${NAME}\\s+)?(?:geschickt|gesendet|geschrieben|verschickt|weitergeleitet)(?:\\s+(?:habe|hab|hatte))?${E}`,
        heSent: `${B}(?:was|welche|die|das)?\\s*(?:hat|haben)\\s+${NAME}\\s+(?:mir\\s+|uns\\s+)?(?:geschickt|gesendet|geschrieben|verschickt|weitergeleitet|geantwortet)${E}`,
        roles: [["von", "from"], ["vom", "from"], ["an", "to"], ["cc", "to"], ["mit", "involves"]],
        rolePattern: (word) => `${B}${word}\\s+${NAME}`,
      },
      folder: {
        wrap: (fre) => `${B}(?:(?:im|in|aus\\s+dem|aus|in\\s+den|unter)\\s+)?(?:ordner\\s+)?(?:${fre})${E}`,
        named: `${B}(?:im|in|aus\\s+dem)\\s+ordner\\s+("[^"]+"|\\S+)`,
      },
    };
  },
};
