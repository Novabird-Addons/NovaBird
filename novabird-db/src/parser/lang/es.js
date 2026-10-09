// Sprachpaket Spanisch.
import { B, E } from "./common.js";

const set = (s) => new Set(s.split(/\s+/).filter(Boolean));

export default {
  code: "es",
  months: {
    enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3, abril: 4, abr: 4, mayo: 5, junio: 6, jun: 6,
    julio: 7, jul: 7, agosto: 8, ago: 8, septiembre: 9, setiembre: 9, sept: 9, sep: 9, octubre: 10, oct: 10,
    noviembre: 11, nov: 11, diciembre: 12, dic: 12,
  },
  numbers: {
    un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11,
    doce: 12, veinte: 20, treinta: 30,
  },
  half: "medio|media",
  slashDates: true,
  dayMonth: (M) => `\\d{1,2}\\s+(?:de\\s+)?(?:${M})(?:\\s+(?:de\\s+)?(?:19|20)\\d{2})?`,
  units: [
    { unit: "day", words: ["días", "dias", "día", "dia"], plural: ["días", "dias"] },
    { unit: "week", words: ["semanas", "semana"], plural: ["semanas"] },
    { unit: "month", words: ["meses", "mes"], plural: ["meses"] },
    { unit: "quarter", words: ["trimestres", "trimestre"], plural: ["trimestres"] },
    { unit: "year", words: ["años", "anos", "año", "ano"], plural: ["años", "anos"] },
  ],
  attachmentTypes: [
    { type: "pdf", re: "pdfs?" },
    { type: "excel", re: "excel|xlsx|xls|csv|hojas?\\s+de\\s+cálculo" },
    { type: "word", re: "word|docx|doc" },
    { type: "image", re: "imágenes|imagenes|imagen|fotos?|jpe?g|png|capturas?(?:\\s+de\\s+pantalla)?|screenshots?" },
    { type: "powerpoint", re: "powerpoint|pptx|ppt|presentaciones?" },
    { type: "archive", re: "zip" },
  ],
  folders: [
    { type: "inbox", re: "bandeja\\s+de\\s+entrada|entrada|inbox" },
    { type: "sent", re: "elementos\\s+enviados|correos?\\s+enviados|enviados|enviadas|bandeja\\s+de\\s+salida|salida" },
    { type: "archives", re: "archivados?|archivo" },
    { type: "drafts", re: "borradores|borrador" },
    { type: "trash", re: "papelera|elementos\\s+eliminados|eliminados|borrados" },
    { type: "junk", re: "spam|correo\\s+no\\s+deseado|no\\s+deseados?|basura|junk" },
  ],
  filler: set(`yo tú tu usted él ella nosotros ustedes ellos ellas me mi mis nuestro nuestros busca buscar busco buscando encuentra encontrar
    muestra muestrame mostrar dame dar por favor el la los las lo un una unos unas del al de y o u todos todas todo toda
    correos correo emails email e-mail e-mails mensajes mensaje en sobre bajo con sin por para a hacia desde hasta entre según
    acerca tema asunto que cuál cuáles qué quién dónde cómo es son era eran fue han ha he hemos has
    enviado enviados enviada enviadas recibido recibidos recibida recibidas escrito escritos escrita escritas este esta estos estas ese esa
    eso esto también ya aún así como tal algo cosa cosas`),
  notAName: [
    "adjunto", "adjuntos", "archivo", "archivos", "estrella", "tag", "etiqueta", "hoy", "ayer", "anteayer", "antier",
    "último", "ultimo", "última", "ultima", "últimos", "ultimos", "últimas", "ultimas", "este", "esta", "desde", "hasta", "antes", "después",
    "semana", "mes", "año",
  ],
  orWords: ["o"],
  notWords: ["sin", "excepto", "salvo", "ningún", "ninguno", "ninguna", "no"],
  stemRules: [["es", ""], ["s", ""], ["a", ""], ["o", ""]],
  ops: {
    from: ["de"], to: ["para", "a"], cc: [], with: ["con"], subject: ["asunto"], attachment: ["adjunto"],
    text: ["texto"], is: ["es"], tag: ["etiqueta"], folder: ["carpeta"], since: ["desde"], until: ["hasta"], date: ["fecha"],
  },
  vals: {
    meFrom: ["mí", "mi", "yo"], meTo: ["mí", "mi"], no: ["no", "sin"], unread: ["noleído", "no-leído"], read: ["leído", "leido"],
    flagged: ["marcado", "destacado", "estrella", "favorito"],
  },
  relDays: { hoy: 0, ayer: -1, anteayer: -2, antier: -2 },
  patterns(f) {
    const { NUM, UNIT, ANCHOR, MONTH, NAME, NUMDATE } = f;
    const LAST = "(?:últimos?|ultimos?|últimas?|ultimas?|pasad[oa]s?|anteriores|anterior)";
    const ATT = "(?:adjuntos?|archivos?\\s+adjuntos?|anexos?)";
    return {
      dates: {
        between: `${B}entre\\s+(?:el\\s+)?(${ANCHOR})\\s+y\\s+(?:el\\s+)?(${ANCHOR})${E}`,
        range: `${B}(?:del|de|desde)?\\s*(${ANCHOR})\\s*(?:al|a|hasta|-|–)\\s*(${ANCHOR})${E}`,
        lastN: `${B}(?:(?:en|durante|dentro\\s+de)\\s+)?(?:(?:los|las)\\s+)?${LAST}\\s+(${NUM})\\s+(${UNIT})${E}`,
        sinceN: `${B}desde\\s+hace\\s+(${NUM})\\s+(${UNIT})${E}`,
        agoN: `${B}hace\\s+(${NUM})\\s+(${UNIT})${E}`,
        lastUnit: `${B}(?:(?:en|durante)\\s+)?(?:(?:los|las|el|la)\\s+)?${LAST}\\s+(${UNIT})${E}|${B}(?:(?:en|durante)\\s+)?(?:(?:el|la)\\s+)?(${UNIT})\\s+(?:pasad[oa]|anterior)${E}`,
        thisUnit: `${B}(?:en\\s+)?(?:esta|este)\\s+(${UNIT})${E}`,
        relDay: `${B}(?:desde\\s+|de\\s+)?(hoy|anteayer|antier|ayer)${E}`,
        week: `${B}(?:en\\s+la\\s+)?semana\\s*(\\d{1,2})(?:\\s*[/.]?\\s*((?:19|20)\\d{2}))?${E}`,
        since: `${B}(?:desde|a\\s+partir\\s+(?:del|de))\\s+(?:el\\s+|principios\\s+de\\s+)?(${ANCHOR})${E}`,
        until: `${B}(?:hasta|antes\\s+del?)\\s+(?:el\\s+)?(?:finales\\s+de\\s+|fin\\s+de\\s+)?(${ANCHOR})${E}`,
        monthIn: `${B}(?:(?:en|durante|de|del)\\s+(?:el\\s+mes\\s+de\\s+)?(${MONTH})(?:\\s+(?:de\\s+)?((?:19|20)\\d{2}))?|(${MONTH})\\s+(?:de\\s+)?((?:19|20)\\d{2}))${E}`,
        onDate: `${B}(?:el\\s+|del\\s+)?(${NUMDATE}|\\d{4}-\\d{2}-\\d{2})(?![\\p{L}\\p{N}])`,
        year: `${B}(?:(?:en|de|del|durante|el\\s+año)\\s+)?((?:19|20)\\d{2})${E}`,
      },
      attach: {
        without: `${B}sin\\s+${ATT}${E}`,
        with: `${B}(?:con|incluyendo)\\s+(?:un\\s+|una\\s+|los\\s+)?${ATT}${E}`,
        type: (tre) => `${B}(?:(?:en|con|como|vía|via|por)\\s+)?(?:un\\s+|una\\s+|unos\\s+)?(?:(?:archivos?|documentos?|adjuntos?)\\s+(?:de\\s+tipo\\s+)?)?(?:${tre})(?:[\\s-]?(?:archivos?|documentos?|adjuntos?))?(?:-(?=\\p{L})|(?![\\p{L}\\p{N}]))`,
      },
      status: {
        unread: `${B}(?:no\\s+leíd[oa]s?|no\\s+leid[oa]s?|sin\\s+leer)${E}`,
        read: `${B}(?:ya\\s+)?(?:leíd[oa]s?|leid[oa]s?)${E}`,
        flagged: `${B}(?:marcad[oa]s?|destacad[oa]s?|con\\s+estrella|favoritos?)${E}`,
        tag: `${B}(?:con\\s+(?:la\\s+)?)?(?:etiqueta|tag)\\s+("[^"]+"|\\S+)`,
      },
      persons: {
        fromMe: `${B}de\\s+m[ií]${E}`,
        toMe: `${B}(?:para|a)\\s+m[ií]${E}`,
        iSent: `${B}(?:(?:los\\s+|las\\s+)?(?:correos?|mensajes?|emails?)\\s+)?(?:que\\s+)?(?:yo\\s+)?(?:envié|envie|escribí|escribi|reenvié|reenvie|mandé|mande)(?:\\s+a\\s+${NAME})?${E}`,
        heSent: [
          `${B}(?:lo\\s+que|que|qué)\\s+${NAME}\\s+(?:me\\s+|nos\\s+)?(?:envió|envio|escribió|escribio|mandó|mando|reenvió|reenvio|respondió|respondio)${E}`,
          `${B}(?:me|nos)\\s+(?:envió|envio|escribió|escribio|mandó|mando|reenvió|reenvio|respondió|respondio)\\s+${NAME}${E}`,
        ],
        roles: [["de", "from", true], ["del", "from", true], ["para", "to"], ["a", "to", true], ["cc", "to"], ["con", "involves"]],
        rolePattern: (word) => `${B}${word}\\s+${NAME}`,
      },
      folder: {
        wrap: (fre) => `${B}(?:(?:en|desde|bajo)\\s+(?:la\\s+|el\\s+|los\\s+|mi\\s+|mis\\s+)?)?(?:carpeta\\s+)?(?:${fre})${E}`,
        named: `${B}(?:en|desde)\\s+(?:la\\s+)?carpeta\\s+("[^"]+"|\\S+)`,
      },
    };
  },
};
