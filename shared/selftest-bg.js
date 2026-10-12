/* NovaBird – Selbsttest, Teil Hintergrundseite (Quelle: Source/shared/selftest-bg.js; im Paket shared/selftest-bg.js).
 * Fragt die selfTest()-Funktionen der Experimente ab: 20 s nach dem Start (solange noch kein Fenster da ist, alle 30 s
 * erneut) und jedes Mal, wenn die Optionsseite geöffnet wird (sie schreibt storage.local "selfTestRequest"). Kein
 * Dauer-Timer: Meldungen beim Einhängen (Adressbuch, Verfassen-Fenster …) kommen so spätestens beim Öffnen der Optionsseite an.
 * Ergebnis in storage.local "selfTest": { app, version, missing: [...], at }; angezeigt mit shared/selftest-ui.js.
 */
"use strict";

function nbStartSelfTest(sources, { firstMs = 20000, retryMs = 30000 } = {}) {
  let last = null;
  let retry = null;
  const run = async () => {
    clearTimeout(retry);
    const results = [];
    for (const source of sources) {
      try {
        const r = await source();
        if (r) results.push(r);
      } catch (e) {
        console.error("NovaBird-Selbsttest:", e);
      }
    }
    if (!results.length) return null;
    const res = {
      app: results[0].app,
      version: results[0].version,
      missing: [...new Set(results.flatMap(r => r.missing || []))].sort(),
      at: Date.now(),
    };
    const sig = JSON.stringify([res.version, res.missing]);
    if (sig !== last) {
      last = sig;
      await messenger.storage.local.set({ selfTest: res });
    }
    if (results.some(r => r.pending)) retry = setTimeout(run, retryMs);
    return res;
  };
  setTimeout(run, firstMs);
  messenger.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.selfTestRequest) run();
  });
  return run;
}
