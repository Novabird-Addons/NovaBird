"use strict";
/* Protokoll des Nova-Contact: Einträge laufen über das Experiment (nur Arbeitsspeicher, nur wenn in den Einstellungen eingeschaltet). */
(() => {
  const api = globalThis.messenger || globalThis.browser;
  const t = (...a) => I18N.t(...a);
  let timer = null;
  const CPLog = {
    add(text) { try { api.novaContact.log(text); } catch (e) { /* ohne Experiment kein Protokoll */ } },
    async render() {
      const box = document.getElementById("logList");
      if (!box || document.getElementById("logPanel").hidden) return;
      let list = [];
      try { list = await api.novaContact.getLog(); } catch (e) {}
      box.textContent = list.length
        ? list.slice().reverse().map(e => new Date(e.ts).toLocaleTimeString(I18N.locale()) + "  " + e.text).join("\n")
        : t("logEmpty");
    },
  };
  globalThis.CPLog = CPLog;
  async function apply() {
    let on = false;
    try { on = !!(await api.storage.local.get({ pilotLog: false })).pilotLog; } catch (e) {}
    document.getElementById("logPanel").hidden = !on;
    clearInterval(timer);
    if (on) { CPLog.render(); timer = setInterval(() => { if (!document.hidden) CPLog.render(); }, 3000); }
  }
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("logClear").addEventListener("click", async () => { try { await api.novaContact.clearLog(); } catch (e) {} CPLog.render(); });
    apply();
    try { api.storage.onChanged.addListener(ch => { if (ch.pilotLog) apply(); }); } catch (e) {}
    I18N.onChange(() => CPLog.render());
  });
})();
