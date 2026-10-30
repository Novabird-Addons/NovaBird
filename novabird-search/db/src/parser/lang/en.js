// Sprachpaket Englisch.
import { B, E } from "./common.js";

const set = (s) => new Set(s.split(/\s+/).filter(Boolean));

export default {
  code: "en",
  months: {
    january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
    july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9, october: 10, oct: 10,
    november: 11, nov: 11, december: 12, dec: 12,
  },
  numbers: {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    twenty: 20, thirty: 30,
  },
  half: "half(?:\\s+a)?",
  slashDates: true,
  dayMonth: (M) => `(?:\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${M})|(?:${M})\\s+\\d{1,2}(?:st|nd|rd|th)?)(?:,?\\s+(?:19|20)\\d{2})?`,
  units: [
    { unit: "day", words: ["days", "day"], plural: ["days"] },
    { unit: "week", words: ["weeks", "week"], plural: ["weeks"] },
    { unit: "month", words: ["months", "month"], plural: ["months"] },
    { unit: "quarter", words: ["quarters", "quarter"], plural: ["quarters"] },
    { unit: "year", words: ["years", "year"], plural: ["years"] },
  ],
  attachmentTypes: [
    { type: "pdf", re: "pdfs?" },
    { type: "excel", re: "excel|xlsx|xls|csv|spreadsheets?" },
    { type: "word", re: "ms-?word|docx|doc|word\\s+(?:files?|docs?|documents?|attachments?)" },
    { type: "image", re: "images?|pictures?|photos?|jpe?g|png|screenshots?" },
    { type: "powerpoint", re: "powerpoint|pptx|ppt|slides?" },
    { type: "archive", re: "zip" },
  ],
  folders: [
    { type: "inbox", re: "inbox" },
    { type: "sent", re: "sent\\s+(?:items|mail|messages)|sent|outbox" },
    { type: "archives", re: "archives?" },
    { type: "drafts", re: "drafts?" },
    { type: "trash", re: "trash|deleted(?:\\s+items)?|bin" },
    { type: "junk", re: "spam|junk" },
  ],
  filler: set(`i you he she we they me my mine our us find search searching look looking show give get gimme please
    the a an of and or all any every each some mails mail emails email e mails e mail message messages
    in on at by for about regarding re concerning that which what who whom whose where when how is are was were be been
    has have had do does did sent received got come came wrote written send forward forwarded replied
    from to with within during over into onto it its this these those there here so also just only then than
    like such thing things stuff something anything related`),
  notAName: [
    "attachment", "attachments", "star", "tag", "label", "today", "yesterday", "last", "past", "previous", "this", "current",
    "since", "until", "before", "after", "week", "month", "year", "day", "days", "weeks", "months", "years",
  ],
  orWords: ["or"],
  notWords: ["without", "not", "except", "excluding", "no"],
  stemRules: [["ies", "y"], ["ing", ""], ["ed", ""], ["es", ""], ["s", ""]],
  ops: {
    from: [], to: [], cc: [], with: ["with"], subject: [], attachment: [], text: [], is: [], tag: [], folder: [], since: [], until: [], date: [],
  },
  vals: { meFrom: [], meTo: [], no: ["without"], unread: [], read: [], flagged: ["flagged", "starred", "star"] },
  relDays: { today: 0, yesterday: -1 },
  patterns(f) {
    const { NUM, UNIT, ANCHOR, MONTH, NAME, NUMDATE } = f;
    const PRE = "(?:(?:from|in|within|during|over|of|for)\\s+)?(?:the\\s+)?";
    const LAST = "(?:last|past|previous|prior)";
    const THIS = "(?:this|current)";
    const ATT = "(?:attachments?|attached\\s+files?)";
    return {
      dates: {
        between: `${B}between\\s+(${ANCHOR})\\s+and\\s+(${ANCHOR})${E}`,
        range: `${B}(?:from)?\\s*(${ANCHOR})\\s*(?:to|until|through|-|–)\\s*(${ANCHOR})${E}`,
        lastN: `${B}${PRE}${LAST}\\s+(${NUM})\\s+(${UNIT})${E}`,
        sinceN: `${B}since\\s+(${NUM})\\s+(${UNIT})(?:\\s+ago)?${E}`,
        agoN: `${B}(${NUM})\\s+(${UNIT})\\s+ago${E}`,
        lastUnit: `${B}${PRE}${LAST}\\s+(${UNIT})${E}`,
        thisUnit: `${B}(?:(?:in|during|from|of)\\s+)?${THIS}\\s+(${UNIT})${E}`,
        relDay: `${B}(?:from\\s+|since\\s+)?(today|yesterday)${E}`,
        week: `${B}(?:in\\s+(?:the\\s+)?)?(?:calendar\\s+week|week|cw)\\s*(\\d{1,2})(?:\\s*[/.]?\\s*((?:19|20)\\d{2}))?${E}`,
        since: `${B}(?:since|after)\\s+(?:the\\s+)?(?:beginning\\s+of\\s+)?(${ANCHOR})${E}`,
        until: `${B}(?:until|before|till|by)\\s+(?:the\\s+)?(?:end\\s+of\\s+)?(${ANCHOR})${E}`,
        monthIn: `${B}(?:(?:in|during|from|of)\\s+(?:the\\s+month\\s+of\\s+)?(${MONTH})(?:\\s+((?:19|20)\\d{2}))?|(${MONTH})\\s+((?:19|20)\\d{2}))${E}`,
        onDate: `${B}(?:on\\s+|from\\s+)?(${NUMDATE}|\\d{4}-\\d{2}-\\d{2})(?![\\p{L}\\p{N}])`,
        year: `${B}(?:(?:in\\s+(?:the\\s+year\\s+)?|from|during|of)\\s+)?((?:19|20)\\d{2})${E}`,
      },
      attach: {
        without: `${B}without\\s+(?:an?\\s+)?${ATT}${E}`,
        with: `${B}(?:with|incl\\.?|including)\\s+(?:an?\\s+|the\\s+)?${ATT}${E}`,
        type: (tre) => `${B}(?:(?:as|with|in|via)\\s+)?(?:an?\\s+)?(?:${tre})(?:[\\s-]?(?:attachments?|files?|documents?))?(?:-(?=\\p{L})|(?![\\p{L}\\p{N}]))`,
      },
      status: {
        unread: `${B}(?:unread|not\\s+(?:yet\\s+)?read)${E}`,
        read: `${B}(?:already\\s+)?read${E}`,
        flagged: `${B}(?:flagged|starred|with\\s+(?:a\\s+)?star)${E}`,
        tag: `${B}(?:with\\s+(?:the\\s+)?)?(?:tag|label)\\s+("[^"]+"|\\S+)`,
      },
      persons: {
        fromMe: `${B}from\\s+me${E}`,
        toMe: `${B}to\\s+me${E}`,
        iSent: `${B}(?:(?:the\\s+)?(?:ones?|e-?mails?|mails?|messages?)\\s+)?(?:that\\s+|which\\s+)?i\\s+(?:sent|wrote|forwarded)(?:\\s+to\\s+${NAME})?${E}`,
        heSent: `${B}(?:what|which|that)\\s+(?:did\\s+)?${NAME}\\s+(?:send|sent|write|wrote|forward|forwarded|reply|replied)(?:\\s+(?:me|us))?${E}`,
        roles: [["from", "from"], ["by", "from"], ["to", "to"], ["cc", "to"], ["with", "involves"]],
        rolePattern: (word) => `${B}${word}\\s+${NAME}`,
      },
      folder: {
        wrap: (fre) => `${B}(?:(?:in|from|under)\\s+(?:the\\s+|my\\s+)?)?(?:folder\\s+)?(?:${fre})${E}`,
        named: `${B}(?:in|from)\\s+(?:the\\s+)?folder\\s+("[^"]+"|\\S+)`,
      },
    };
  },
};
