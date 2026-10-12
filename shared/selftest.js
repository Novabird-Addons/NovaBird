/* NovaBird – Selbsttest der Betterbird-Interna (Quelle: Source/shared/selftest.js; im Paket shared/selftest.js).
 * Für Experimente, geladen per Services.scriptloader.loadSubScript in ein eigenes Objekt. Nach einem Betterbird-Update
 * (neue ESR) können interne Funktionen fehlen, an denen ein Add-on hängt. Die Add-ons hängen sich dann nicht ein
 * (bestehende Prüfungen) und melden hier, welche Funktion deshalb aus ist; die Optionsseite zeigt das an.
 * Zwei Wege: Prüfliste beim Abfragen (nbRunSelfTest) und Meldung beim Einhängen (nbReportMissing), für Teile, die erst
 * später geladen werden (Adressbuch, Verfassen-Fenster, Einstellungen).
 */
"use strict";

var nbMissingAtHook = new Set();

/** Beim Einhängen festgestellt: Funktion `feature` ist nicht verfügbar (detail = was fehlte, nur für die Konsole). */
function nbReportMissing(feature, detail) {
  if (!nbMissingAtHook.has(feature)) {
    nbMissingAtHook.add(feature);
    console.warn(`NovaBird-Selbsttest: „${feature}“ nicht verfügbar (${detail || "?"}) in ${Services.appinfo.name} ${Services.appinfo.version}`);
  }
}

/**
 * Prüft die Liste [{ feature, needs: "main"|"3pane"|"none", test(env) }] gegen das zuletzt aktive Hauptfenster und sein
 * erstes fertig geladenes about:3pane. env = { win, cw, hasModule(url) }. Prüfungen, deren Fenster fehlt, zählen als
 * „noch offen“ (pending), nicht als Fehler. Ergebnis: { app, version, missing: [feature …], pending }.
 */
function nbRunSelfTest(checks) {
  const win = Services.wm.getMostRecentWindow("mail:3pane");
  let cw = null;
  try {
    for (const info of win?.document.getElementById("tabmail")?.tabInfo ?? []) {
      const w = info.chromeBrowser?.contentWindow;
      if (w?.location?.href === "about:3pane" && w.document.readyState === "complete") {
        cw = w;
        break;
      }
    }
  } catch (e) {
    cw = null;
  }
  const hasModule = url => {
    try {
      ChromeUtils.importESModule(url);
      return true;
    } catch (e) {
      return false;
    }
  };
  const env = { win, cw, hasModule };
  const missing = new Set(nbMissingAtHook);
  let pending = false;
  for (const check of checks) {
    if ((check.needs === "main" && !win) || (check.needs === "3pane" && !cw)) {
      pending = true;
      continue;
    }
    try {
      if (!check.test(env)) {
        missing.add(check.feature);
      }
    } catch (e) {
      missing.add(check.feature);
    }
  }
  return { app: Services.appinfo.name, version: Services.appinfo.version, missing: [...missing].sort(), pending };
}
