"use strict";
/* Schriftgröße des Nova-Contact: Faktor aus den Einstellungen (Reiter "Farben und Schrift"), 100 % = bisherige Größe.
   Alle Größen der Seite sind rem, daher genügt die Schrift der Wurzel. */
(() => {
  const api = globalThis.messenger || globalThis.browser;
  async function apply() {
    let pct = 100;
    try { pct = Number((await api.storage.local.get({ fontContact: 100 })).fontContact) || 100; } catch (e) {}
    pct = Math.min(200, Math.max(50, pct));
    document.documentElement.style.fontSize = pct === 100 ? "" : pct + "%";
  }
  apply();
  try { api.storage.onChanged.addListener(ch => { if (ch.fontContact) apply(); }); } catch (e) {}
})();
