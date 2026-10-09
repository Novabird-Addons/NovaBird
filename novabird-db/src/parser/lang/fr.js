// Sprachpaket Französisch.
import { B, E } from "./common.js";

const set = (s) => new Set(s.split(/\s+/).filter(Boolean));

export default {
  code: "fr",
  months: {
    janvier: 1, janv: 1, février: 2, fevrier: 2, févr: 2, fevr: 2, mars: 3, avril: 4, avr: 4, mai: 5, juin: 6,
    juillet: 7, juil: 7, août: 8, aout: 8, septembre: 9, sept: 9, octobre: 10, oct: 10, novembre: 11, nov: 11,
    décembre: 12, decembre: 12, déc: 12, dec: 12,
  },
  numbers: {
    un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12,
    vingt: 20, trente: 30,
  },
  half: "demi|demie",
  slashDates: true,
  dayMonth: (M) => `\\d{1,2}(?:er)?\\s+(?:${M})(?:\\s+(?:19|20)\\d{2})?`,
  units: [
    { unit: "day", words: ["jours", "jour"], plural: ["jours"] },
    { unit: "week", words: ["semaines", "semaine"], plural: ["semaines"] },
    { unit: "month", words: ["mois"], plural: [] },
    { unit: "quarter", words: ["trimestres", "trimestre"], plural: ["trimestres"] },
    { unit: "year", words: ["années", "annees", "année", "annee", "ans", "an"], plural: ["années", "annees", "ans"] },
  ],
  attachmentTypes: [
    { type: "pdf", re: "pdfs?" },
    { type: "excel", re: "excel|xlsx|xls|csv|tableurs?" },
    { type: "word", re: "word|docx|doc" },
    { type: "image", re: "images?|photos?|jpe?g|png|captures?(?:\\s+d['’]écran)?|screenshots?" },
    { type: "powerpoint", re: "powerpoint|pptx|ppt|diaporamas?" },
    { type: "archive", re: "zip" },
  ],
  folders: [
    { type: "inbox", re: "boîte\\s+de\\s+réception|boite\\s+de\\s+reception|réception|inbox" },
    { type: "sent", re: "éléments\\s+envoyés|messages\\s+envoyés|envoyés|envoyées|envoyé|boîte\\s+d['’]envoi|outbox" },
    { type: "archives", re: "archives?|archivés" },
    { type: "drafts", re: "brouillons?" },
    { type: "trash", re: "corbeille|éléments\\s+supprimés|supprimés" },
    { type: "junk", re: "spam|courrier\\s+indésirable|indésirables?|pourriels?|junk" },
  ],
  filler: set(`je tu il elle nous vous ils elles me moi mon ma mes notre nos cherche chercher recherche rechercher trouve trouver
    montre montrer affiche afficher donne donner s'il svp merci le la les l un une des du de d au aux et ou tous toutes tout toute
    mails mail e-mails e-mail emails email courriel courriels message messages dans en sur sous par pour avec sans chez vers
    concernant sujet à a ont est sont était étaient été ai as avons avez qui que qu quoi quel quelle quels quelles où
    envoyé envoyés envoyée envoyées reçu reçus reçue reçues écrit écrits écrite écrites ce cet cette ces ça cela ceci
    dont il y ya aussi encore déjà donc alors comme tel telle quelque quelques chose choses truc`),
  notAName: [
    "pièce", "piece", "jointe", "pièces", "pieces", "jointes", "étoile", "etoile", "tag", "étiquette", "aujourd", "hier",
    "dernier", "dernière", "derniers", "dernières", "cette", "cet", "depuis", "jusqu", "avant", "après", "semaine", "mois", "année",
  ],
  orWords: ["ou"],
  notWords: ["sans", "pas", "sauf", "aucun", "aucune"],
  stemRules: [["es", ""], ["s", ""], ["x", ""], ["e", ""]],
  ops: {
    from: ["de"], to: ["à", "pour"], cc: [], with: ["avec"], subject: ["objet", "sujet"], attachment: ["pj", "pièce"],
    text: ["texte"], is: ["est"], tag: ["étiquette"], folder: ["dossier"], since: ["depuis", "dès"], until: ["jusque", "avant"], date: [],
  },
  vals: {
    meFrom: ["moi"], meTo: ["moi"], no: ["non", "sans"], unread: ["nonlu", "non-lu", "nonlus"], read: ["lu", "lus"],
    flagged: ["marqué", "marque", "étoile", "etoile", "favori"],
  },
  relDays: { "aujourd'hui": 0, hier: -1, "avant-hier": -2 },
  patterns(f) {
    const { NUM, UNIT, ANCHOR, MONTH, NAME, NUMDATE } = f;
    const ART = "(?:(?:la|le|les|l['’])\\s*)?";
    const LAST = "(?:derniers?|dernières?|précédents?|passés?|passées?)";
    const ATT = "(?:pièces?\\s+jointes?|pieces?\\s+jointes?|pj|attachements?)";
    return {
      dates: {
        between: `${B}entre\\s+(?:le\\s+)?(${ANCHOR})\\s+et\\s+(?:le\\s+)?(${ANCHOR})${E}`,
        range: `${B}(?:du|de|depuis)?\\s*(${ANCHOR})\\s*(?:au|à|jusqu['’]au|-|–)\\s*(${ANCHOR})${E}`,
        lastN: [
          `${B}(?:(?:au\\s+cours\\s+des|pendant\\s+les|dans\\s+les|sur\\s+les|ces|les)\\s+)?${LAST}\\s+(${NUM})\\s+(${UNIT})${E}`,
          `${B}(?:(?:au\\s+cours\\s+des|pendant\\s+les|dans\\s+les|sur\\s+les|ces|les)\\s+)?(${NUM})\\s+${LAST}\\s+(${UNIT})${E}`,
        ],
        sinceN: `${B}depuis\\s+(${NUM})\\s+(${UNIT})${E}`,
        agoN: `${B}il\\s+y\\s+a\\s+(${NUM})\\s+(${UNIT})${E}`,
        lastUnit: `${B}(?:(?:ces|les|la|le|l['’])\\s*)?${LAST}s?\\s+(${UNIT})${E}|${B}${ART}(${UNIT})\\s+(?:dernier|dernière|passé|passée|précédent|précédente)${E}`,
        thisUnit: `${B}(?:cette|ce|cet)\\s+(${UNIT})${E}`,
        relDay: `${B}(?:depuis\\s+|de\\s+)?(aujourd['’]hui|avant-hier|hier)${E}`,
        week: `${B}(?:en\\s+|de\\s+la\\s+)?(?:semaine|sem\\.?)\\s*(\\d{1,2})(?:\\s*[/.]?\\s*((?:19|20)\\d{2}))?${E}`,
        since: `${B}(?:depuis|dès|à\\s+partir\\s+(?:du|de))\\s+(?:le\\s+|début\\s+|debut\\s+)?(${ANCHOR})${E}`,
        until: `${B}(?:jusqu['’]\\s*(?:à|a|au|en)|avant)\\s+(?:le\\s+|fin\\s+)?(${ANCHOR})${E}`,
        monthIn: `${B}(?:(?:en|durant|pendant|dans|au\\s+mois\\s+de|au\\s+mois\\s+d['’]|de|du|d['’])\\s*(${MONTH})(?:\\s+((?:19|20)\\d{2}))?|(${MONTH})\\s+((?:19|20)\\d{2}))${E}`,
        onDate: `${B}(?:le\\s+|du\\s+)?(${NUMDATE}|\\d{4}-\\d{2}-\\d{2})(?![\\p{L}\\p{N}])`,
        year: `${B}(?:(?:en|de|dans|durant|l['’]année)\\s+)?((?:19|20)\\d{2})${E}`,
      },
      attach: {
        without: `${B}sans\\s+(?:une?\\s+|de\\s+)?${ATT}${E}`,
        with: `${B}(?:avec|incluant|y\\s+compris)\\s+(?:une?\\s+|des\\s+|les\\s+)?${ATT}${E}`,
        type: (tre) => `${B}(?:(?:en|au\\s+format|avec|comme|via|par)\\s+)?(?:un\\s+|une\\s+|des\\s+)?(?:(?:fichiers?|documents?|pièces?\\s+jointes?)\\s+(?:de\\s+type\\s+|au\\s+format\\s+)?)?(?:${tre})(?:[\\s-]?(?:fichiers?|documents?|pièces?\\s+jointes?))?(?:-(?=\\p{L})|(?![\\p{L}\\p{N}]))`,
      },
      status: {
        unread: `${B}(?:non[\\s-]lu(?:e)?s?|pas\\s+lu(?:e)?s?|nonlu(?:e)?s?)${E}`,
        read: `${B}(?:déjà\\s+)?lu(?:e)?s?${E}`,
        flagged: `${B}(?:marqué(?:e)?s?|étoilé(?:e)?s?|favoris|avec\\s+(?:une\\s+)?étoile)${E}`,
        tag: `${B}(?:avec\\s+(?:l['’]\\s*)?)?(?:étiquette|tag|mot-clé)\\s+("[^"]+"|\\S+)`,
      },
      persons: {
        fromMe: `${B}de\\s+moi${E}`,
        toMe: `${B}(?:à|pour)\\s+moi${E}`,
        iSent: `${B}(?:(?:les\\s+)?(?:e-?mails?|mails?|messages?|courriels?)\\s+)?(?:que\\s+)?j['’]ai\\s+(?:envoyé|envoyée|envoyés|envoyées|écrit|écrits|écrite|écrites|transféré|transférés|transférée|transférées)(?:\\s+à\\s+${NAME})?${E}`,
        heSent: [
          `${B}(?:ce\\s+que|qu['’]est-ce\\s+que|que|qu['’])\\s*${NAME}\\s+(?:m['’]\\s*|nous\\s+|vous\\s+)?a\\s+(?:envoyé|envoyée|envoyés|envoyées|écrit|transféré|répondu)${E}`,
          `${B}${NAME}\\s+m['’]a\\s+(?:envoyé|envoyée|envoyés|envoyées|écrit|transféré|répondu)${E}`,
        ],
        roles: [["de", "from", true], ["d['’]", "from", true], ["à", "to"], ["pour", "to"], ["cc", "to"], ["avec", "involves"]],
        rolePattern: (word) => (word === "d['’]" ? `${B}d['’]\\s*${NAME}` : `${B}${word}\\s+${NAME}`),
      },
      folder: {
        wrap: (fre) => `${B}(?:(?:dans|depuis|sous)\\s+(?:le\\s+|la\\s+|les\\s+|l['’]\\s*|mes\\s+|mon\\s+)?)?(?:dossier\\s+)?(?:${fre})${E}`,
        named: `${B}(?:dans|depuis)\\s+(?:le\\s+)?dossier\\s+("[^"]+"|\\S+)`,
      },
    };
  },
};
