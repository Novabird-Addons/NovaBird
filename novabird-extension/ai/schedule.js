"use strict";

/* Zeitplan für „Was gibt's Neues?“ (Hintergrund): täglich zu einer Uhrzeit oder alle N Stunden.
 * Berücksichtigt werden die ungelesenen Mails seit dem letzten Lauf (höchstens 7 Tage). War Thunderbird zur Uhrzeit aus,
 * wird der Lauf nach dem Start nachgeholt. Ergebnis in storage.local (aiOverviewLast); der Knopf in der Leiste zeigt die
 * Zahl der Mails, eine Benachrichtigung öffnet den Überblick. Nur wenn die KI eingeschaltet ist. Geprüft wird alle 5 Minuten
 * (übersteht Ruhezustand und Uhrzeitwechsel besser als ein langer Timer). */
(() => {
  const SCHEDULE = "aiOverviewSchedule"; // { mode: "off" | "daily" | "hours", time: "07:00", every: 2 }
  const LAST = "aiOverviewLast"; //        { at, scheduled, seen, hours, text, mails, total, suspicious }
  const RUN_AT = "aiOverviewRunAt"; //     Zeitpunkt des letzten geplanten Laufs (ms)
  const NOTE = "nbx-ai-overview";
  const T = {
    de: { title: "Was gibt's Neues?", ready: "Überblick über $1 neue Mails ist fertig – zum Ansehen klicken." },
    en: { title: "What's new?", ready: "Overview of $1 new messages is ready – click to view." },
    fr: { title: "Quoi de neuf ?", ready: "L’aperçu de $1 nouveaux messages est prêt – cliquez pour l’afficher." },
    es: { title: "¿Qué hay de nuevo?", ready: "El resumen de $1 mensajes nuevos está listo: haga clic para verlo." },
  };
  const uiLang = () => (messenger.i18n.getUILanguage() || "en").slice(0, 2).toLowerCase();
  const tx = () => T[uiLang()] || T.en;
  let running = false;

  /** Fälliger Zeitpunkt (ms) oder null; lastRun = letzter geplanter Lauf (ms). */
  function due(s, lastRun, now = new Date()) {
    if (s.mode === "daily") {
      const [h, m] = String(s.time || "07:00").split(":").map(Number);
      const today = new Date(now);
      today.setHours(h || 0, m || 0, 0, 0);
      // heute zur Uhrzeit, falls noch nicht gelaufen (auch nachholen); sonst morgen
      if (!lastRun || lastRun < today.getTime()) return today.getTime();
      today.setDate(today.getDate() + 1);
      return today.getTime();
    }
    if (s.mode === "hours") {
      const every = [1, 2, 4, 8].includes(Number(s.every)) ? Number(s.every) : 2;
      return (lastRun || 0) + every * 3600_000;
    }
    return null;
  }

  async function run(s, lastRun) {
    running = true;
    try {
      const conf = { ...nbAI.DEFAULTS, ...(await messenger.storage.local.get(nbAI.DEFAULTS)) };
      if (!conf.aiEnabled || !conf.aiUrl || (!conf.aiModel && conf.aiType !== "nbhelper")) return;
      // Mails seit dem letzten Lauf (mindestens 1, höchstens 168 Stunden; beim ersten Mal ein Tag bzw. das Intervall)
      const hours = lastRun ? Math.min(168, Math.max(1, Math.ceil((Date.now() - lastRun) / 3600_000))) : s.mode === "hours" ? Number(s.every) || 2 : 24;
      const res = await nbAI.overview(conf, uiLang(), { hours, unreadOnly: true });
      await messenger.storage.local.set({ [LAST]: { at: Date.now(), scheduled: true, seen: false, hours, ...res } });
      if (res.total > 0) {
        await messenger.browserAction.setBadgeText({ text: String(Math.min(res.total, 99)) });
        await messenger.browserAction.setBadgeBackgroundColor({ color: "#2f6fdb" });
        await messenger.notifications.create(NOTE, { type: "basic", iconUrl: "icons/icon-96.png", title: tx().title, message: tx().ready.replace("$1", String(res.total)) });
      }
    } catch (e) {
      console.warn("NovaBird-Extension: geplanter Überblick", e);
    } finally {
      running = false;
    }
  }

  async function check() {
    if (running) return;
    const store = await messenger.storage.local.get({ [SCHEDULE]: { mode: "off" }, [RUN_AT]: 0 });
    const s = store[SCHEDULE] || { mode: "off" };
    const at = due(s, store[RUN_AT]);
    if (at == null || Date.now() < at) return;
    const lastRun = store[RUN_AT];
    await messenger.storage.local.set({ [RUN_AT]: Date.now() }); // vor dem Lauf: kein doppelter Start
    await run(s, lastRun);
  }

  messenger.notifications.onClicked.addListener(id => {
    if (id !== NOTE) return;
    messenger.windows.create({ url: messenger.runtime.getURL("ai/overview.html?win=1"), type: "popup", width: 640, height: 720 }).catch(() => {});
  });
  // Neuer Zeitplan: ab jetzt zählen (nicht sofort für die Vergangenheit rechnen)
  messenger.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[SCHEDULE] && changes[SCHEDULE].newValue?.mode !== changes[SCHEDULE].oldValue?.mode) {
      if ((changes[SCHEDULE].newValue || {}).mode !== "off") messenger.storage.local.set({ [RUN_AT]: Date.now() }).catch(() => {});
    }
  });
  setTimeout(() => check().catch(() => {}), 120_000); // nach dem Start nachholen, was fällig ist
  setInterval(() => check().catch(() => {}), 5 * 60_000);

  globalThis.nbOverviewSchedule = { due };
})();
