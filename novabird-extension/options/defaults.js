/* Standardwerte der Einstellungen der NovaBird-Extension – eine Quelle für Hintergrund (background.js) und Einstellungsseite
 * (options/options.js); vorher standen sie in beiden Dateien und konnten auseinanderlaufen. Die KI-Werte kommen aus
 * nbAI.DEFAULTS (ai/ai.js). */
"use strict";

const NBX_DEFAULTS = {
  attachPane: true,
  paneLayout: "nova",
  agendaDays: 5,
  eventTime: true,
  colorMode: "theme",
  uiTheme: "", // NovaBird-Design (sand, cobalt, springlight); "" = Theme aus dem Add-ons-Manager
  pilotEnabled: true,
  pilotLog: false,
  rulesEnabled: false,
  previewEnabled: true,
  previewDelay: 400,
  listStyle: "default",
  listPreview: true,
  listAvatars: true,
  listDensity: "airy",
  listAcct: "none",
  listScroll: true,
  listAcctColors: {},
  folderInboxes: false,
  folderInboxesHide: [],
  colors: { bg: "#EEF2F8", fg: "#1B2433", border: "#D2DAE6", accent: "#2F6BD8" },
  mainColors: { light: {}, dark: {} },
  fontFamily: "", fontRow: 100, fontPad: 100,
  fontCompose: 100, fontSubject: 100, fontLabels: 100, fontSample: 100,
  fontSettings: 100, fontContact: 100,
  screenEnabled: false, screenFhd: 100, screenQhd: 125, screenUhd: 150,
};
