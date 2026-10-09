/* NovaBird-Conversation – gemeinsame Einstellungen (Hintergrundskript und Optionsseite). */
"use strict";

const SETTINGS_DEFAULTS = {
  style: "soft",              // Aussehen: soft (Sanft, Karten) | clear (Klar, flache Zeilen) | thread (Faden, Zeitleiste)
  order: "newest",            // newest = neueste zuerst, oldest = älteste zuerst
  pin: true,                  // neueste Nachricht beim Scrollen fixieren (nur bei order newest)
  maxHeight: 60,              // maximale Höhe der fixierten Nachricht in % des Fensters (30–90)
  expand: "latestPrev",       // latest | latestPrev | all (ungelesene sind immer aufgeklappt)
  attachments: "top",         // top = über dem Text, bottom = darunter
  collapseQuotes: true,       // zitierten Text hinter „…“ einklappen
  alwaysRender: false,        // auch einzelne Nachrichten in dieser Ansicht zeigen
  fallback: "subject",        // Ersatz für Mails ohne Antwortkette: off | subject (gleicher Betreff, wie üblich) | smart (Betreff + Regeln unten)
  fallbackDays: 30,           // smart: höchstens so viele Tage Abstand zur gewählten Nachricht (1–365)
  fallbackPeople: true,       // smart: mindestens ein gemeinsamer Absender/Empfänger nötig
  engine: "auto",              // auto = NovaBird-DB → Gloda → Betterbird-Suche | db = NovaBird-DB → Suche | gloda = Gloda → Suche | query = immer Betterbird-Suche
  limit: 200,                 // Höchstzahl Nachrichten je Konversation aus dem Index (200 | 1000 | 3000 | 5000)
  rowLines: 2,                // Zeilen Vorschautext bei zugeklappten Nachrichten (1–6)
  stickyHeader: true,         // Kopfzeile aufgeklappter Nachrichten bleibt beim Scrollen langer Texte stehen (Stile Sanft und Klar)
  autoOriginal: true,         // einzelne Mail, die in unserer Ansicht kaum Text zeigt: automatisch Betterbirds Originalansicht
  autoOpen: false,            // ältere Nachrichten beim Scrollen automatisch aufklappen
  autoOpenTrigger: "scroll", // autoOpen: scroll = nur nach dem Scrollen | hover = auch beim bloßen Verweilen des Zeigers
  autoOpenDelay: 80,          // autoOpen: so lange (ms) muss der Zeiger nach dem Scrollen auf einer Zeile stehen bleiben (50–200)
  openMs: 180,                // Dauer der Aufklapp-Animation in ms (0 = aus)
  fadeMs: 90,                 // Einblenden der Konversation beim Laden in ms (0 = aus)
  debugTiming: false,         // Zeiten in der Fehlerkonsole ausgeben (zur Fehlersuche)
  hideHeader: true,           // Standard-Nachrichtenkopf und Anhangsleiste von Betterbird ausblenden
};

function sanitizeSettings(raw) {
  const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
  const bool = (value, fallback) => (typeof value === "boolean" ? value : fallback);
  const clampInt = (value, min, max, fallback) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const d = SETTINGS_DEFAULTS;
  const r = raw || {};
  return {
    style: oneOf(r.style, ["soft", "clear", "thread"], d.style),
    order: oneOf(r.order, ["newest", "oldest"], d.order),
    pin: bool(r.pin, d.pin),
    maxHeight: clampInt(r.maxHeight, 30, 90, d.maxHeight),
    expand: oneOf(r.expand, ["latest", "latestPrev", "all"], d.expand),
    attachments: oneOf(r.attachments, ["top", "bottom"], d.attachments),
    collapseQuotes: bool(r.collapseQuotes, d.collapseQuotes),
    alwaysRender: bool(r.alwaysRender, d.alwaysRender),
    // alte Einstellung subjectFallback (true/false) weiter verstehen
    fallback: oneOf(r.fallback ?? (r.subjectFallback === false ? "off" : undefined), ["off", "subject", "smart"], d.fallback),
    fallbackDays: clampInt(r.fallbackDays, 1, 365, d.fallbackDays),
    fallbackPeople: bool(r.fallbackPeople, d.fallbackPeople),
    hideHeader: bool(r.hideHeader, d.hideHeader),
    engine: oneOf(r.engine, ["auto", "db", "gloda", "query"], d.engine),
    limit: [200, 1000, 3000, 5000].includes(Number(r.limit)) ? Number(r.limit) : d.limit,
    rowLines: clampInt(r.rowLines, 1, 6, d.rowLines),
    stickyHeader: bool(r.stickyHeader, d.stickyHeader),
    autoOriginal: bool(r.autoOriginal, d.autoOriginal),
    autoOpen: bool(r.autoOpen, d.autoOpen),
    autoOpenTrigger: oneOf(r.autoOpenTrigger, ["scroll", "hover"], d.autoOpenTrigger),
    autoOpenDelay: clampInt(r.autoOpenDelay, 50, 200, d.autoOpenDelay),
    openMs: clampInt(r.openMs, 0, 1000, d.openMs),
    fadeMs: clampInt(r.fadeMs, 0, 250, d.fadeMs),
    debugTiming: bool(r.debugTiming, d.debugTiming),
  };
}

if (typeof module !== "undefined") module.exports = { SETTINGS_DEFAULTS, sanitizeSettings };
