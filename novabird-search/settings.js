/* NovaBird-Search – Einstellungen: Standardwerte und Prüfung (für Hintergrundskript und Optionsseite). */
"use strict";

const SETTINGS_KEY = "settings";
const SETTINGS_DEFAULTS = {
  enterMode: "ask",    // Enter: "off" = nichts, "snapshot" = Filtern (Treffer als Momentaufnahme in neuem Tab, dort weiter eingrenzen),
                       //        "analysis" = Auswerten (eigene Analyseseite mit Facetten), "ask" = Rückfrage
  group: false,        // Treffer nach Konversation gruppieren (sonst flache Liste)
  sharedFolders: true, // gemeinsame Ordner anlegen: Gemeinsamer Eingang, Alle ungelesenen, Wiedervorlage
  sharedInboxMonths: 3, // Gemeinsamer Eingang zeigt nur Nachrichten der letzten N Monate (0 = alle)
  glodaLimit: 1000,    // höchstens so viele Volltext-Treffer (neueste zuerst); 0 = unbegrenzt
  sortMode: "date",    // Treffer-Reihenfolge der NovaBird-DB-Suche: "date" (neueste zuerst, Standard) | "relevance"
  novabirdDb: "auto",     // NovaBird-DB (eigener Suchindex) nutzen: "auto" = wenn erkannt und bereit, "off" = nie
};

function sanitizeSettings(raw) {
  const r = raw || {};
  const limit = r.glodaLimit === "" || r.glodaLimit == null ? NaN : Math.round(Number(r.glodaLimit));
  const months = Math.round(Number(r.sharedInboxMonths));
  const modes = ["off", "snapshot", "analysis", "ask"];
  return {
    // frühere Einstellung „newTab“ weiterverwenden
    enterMode: r.enterMode === "facet" ? "analysis" : modes.includes(r.enterMode) ? r.enterMode : r.newTab === true ? "snapshot" : SETTINGS_DEFAULTS.enterMode,
    group: r.group === true,
    sharedFolders: r.sharedFolders !== false,
    sharedInboxMonths: Number.isFinite(months) ? Math.min(60, Math.max(0, months)) : SETTINGS_DEFAULTS.sharedInboxMonths,
    sortMode: r.sortMode === "relevance" ? "relevance" : "date",
    novabirdDb: r.novabirdDb === "off" ? "off" : "auto",
    glodaLimit: Number.isFinite(limit) ? (limit === 0 ? 0 : Math.min(1000000, Math.max(100, limit))) : SETTINGS_DEFAULTS.glodaLimit,
  };
}

if (typeof module !== "undefined") {
  module.exports = { SETTINGS_KEY, SETTINGS_DEFAULTS, sanitizeSettings };
}
