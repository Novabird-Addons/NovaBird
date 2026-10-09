/* NovaBird-Send – Hintergrundlogik: Senden abfangen, Warteschlange, Countdown. */
"use strict";

const DELIVER_NOW = 0;    // nsIMsgCompDeliverMode.Now; 1 wäre "Später senden"
const SEND_WATCHDOG_MS = 20000; // hängt der Versand so lange, Verfassen-Fenster wieder zeigen

let queue = [];        // wartende Mails: { tabId, windowId, subject }
let active = null;     // Mail, deren Countdown gerade läuft
let sending = false;   // true, solange "active" tatsächlich versendet wird
let timer = null;
let sendPromise = null;   // läuft, solange ein Versand aktiv ist (zum Abwarten beim Beenden)
let shuttingDown = false; // verhindert, dass beim Beenden neue Countdowns starten
const approved = new Set(); // Tabs, die beim nächsten onBeforeSend durchgelassen werden

const i18n = (key, substitutions) => messenger.i18n.getMessage(key, substitutions);

// Texte des Overlays an das Experiment geben (die Sprache bestimmt Betterbird über _locales)
async function applyStrings() {
  await messenger.undoOverlay.setStrings({
    waiting: i18n("overlayStatusWaiting"),
    sending: i18n("overlayStatusSending"),
    queued: i18n("overlayQueued", ["{n}"]),
    undo: i18n("overlayUndo"),
    sendNow: i18n("overlaySendNow"),
    ok: i18n("noticeOk"),
  });
}

// Einstellungen (Standardwerte und Prüfung in settings.js)
async function getSettings() {
  return sanitizeSettings(await messenger.storage.local.get(SETTINGS_DEFAULTS));
}

// Fertige Farbpalette: Theme-Farben aus dem Experiment (oder eigene Farben) plus Lesbarkeitsprüfung
async function computePalette(settings) {
  let theme = null;
  try {
    theme = await messenger.undoOverlay.getThemeColors();
  } catch (e) {
    console.error("NovaBird-Send: Theme-Farben nicht lesbar", e);
  }
  return resolvePalette(theme, settings);
}

async function applyStyle() {
  const settings = await getSettings();
  const { size, horizontal, bottom, barHeight, barStyle } = settings;
  const palette = await computePalette(settings);
  await messenger.undoOverlay.setStyle({ size, horizontal, bottom, barHeight, barStyle, palette });
}

async function syncPending() {
  const count = queue.length + (active ? 1 : 0);
  await messenger.undoOverlay.setPendingCount(count);
}

function clearTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

console.log("NovaBird-Send: Hintergrundskript gestartet, undoOverlay =", typeof messenger.undoOverlay);

// 1) Senden abfangen
messenger.compose.onBeforeSend.addListener(async (tab, details) => {
  console.log("NovaBird-Send: onBeforeSend", tab.id, details.subject);
  try {
    return await onBeforeSend(tab, details);
  } catch (e) {
    // Ohne Rückgabe sendet Thunderbird normal weiter; den Fehler wenigstens sichtbar machen.
    console.error("NovaBird-Send: Fehler im Senden-Handler", e);
    return {};
  }
});

async function onBeforeSend(tab, details) {
  if (approved.has(tab.id)) {
    approved.delete(tab.id);
    return {}; // eigener, freigegebener Versand
  }

  // "Später senden" und Offline-Betrieb unverändert durchlassen: Thunderbird zeigt dann seine
  // eigenen Rückfragen/Fehler, die bei verstecktem Fenster sonst unsichtbar blieben.
  const info = await messenger.undoOverlay.getSendInfo(tab.windowId);
  if (info.offline || (info.deliverMode !== null && info.deliverMode !== DELIVER_NOW)) {
    console.log("NovaBird-Send: nicht eingreifen", info);
    return {};
  }

  queue.push({
    tabId: tab.id,
    windowId: tab.windowId,
    subject: details.subject?.trim() || i18n("noSubject"),
  });
  await messenger.undoOverlay.hideComposeWindow(tab.windowId);
  await syncPending();

  if (!active) {
    await startNext();
  } else {
    await messenger.undoOverlay.updateQueued(queue.length);
  }
  return { cancel: true };
}

// 2) Nächste Mail aus der Warteschlange starten (FIFO)
async function startNext() {
  clearTimer();
  if (shuttingDown) {
    return;
  }
  active = queue.shift() || null;
  await syncPending();
  if (!active) {
    await messenger.undoOverlay.hideOverlay();
    return;
  }
  const { delay: seconds } = await getSettings();
  await applyStyle().catch(e => console.error("NovaBird-Send: Stil setzen fehlgeschlagen", e));
  await messenger.undoOverlay.showOverlay({
    subject: active.subject,
    seconds,
    queued: queue.length,
  });
  timer = setTimeout(sendActive, seconds * 1000);
}

// Rückmeldung mit OK-Button, wenn eine Mail nicht gesendet werden konnte
async function notify(item, error) {
  if (!(await getSettings()).showNotices) {
    return;
  }
  let text;
  if (error?.message === "offline") {
    text = i18n("noticeOffline");
  } else if (error?.message) {
    text = i18n("noticeFailed", [String(error.message).slice(0, 160)]);
  } else {
    text = i18n("noticeFailedNoDetail");
  }
  try {
    await messenger.undoOverlay.showNotice({ subject: item.subject, text });
  } catch (e) {
    console.error("NovaBird-Send: Hinweis konnte nicht angezeigt werden", e);
  }
}

// 3) Aktive Mail wirklich senden
async function sendActive() {
  if (!active || sending) {
    return;
  }
  clearTimer();
  sending = true;
  let finished;
  sendPromise = new Promise(resolve => (finished = resolve));
  const item = active;
  await messenger.undoOverlay.setSending();
  approved.add(item.tabId);
  let watchdog = null;
  try {
    // Offline geworden, seit der Countdown läuft: Fenster zurückholen statt zu senden.
    const info = await messenger.undoOverlay.getSendInfo(item.windowId);
    if (info.offline) {
      throw new Error("offline");
    }
    // Hängt der Versand (z. B. wegen einer Rückfrage im versteckten Fenster), Fenster zeigen.
    watchdog = setTimeout(() => {
      messenger.undoOverlay.showComposeWindow(item.windowId).catch(() => {});
    }, SEND_WATCHDOG_MS);
    // sendMessage wirft bei Versandfehlern nicht, sondern liefert { error } zurück.
    const result = await messenger.compose.sendMessage(item.tabId, { mode: "sendNow" });
    if (result?.error) {
      throw new Error(result.error);
    }
  } catch (e) {
    console.error("NovaBird-Send: Versand fehlgeschlagen", e);
    approved.delete(item.tabId);
    // Fenster zurückholen, damit Fehlermeldung und Mail sichtbar sind
    await messenger.undoOverlay.showComposeWindow(item.windowId);
    await notify(item, e);
  } finally {
    clearTimeout(watchdog);
  }
  sending = false;
  active = null;
  finished();
  await startNext();
}

// 4) Rückgängig
async function undoActive() {
  if (!active || sending) {
    return;
  }
  clearTimer();
  const item = active;
  active = null;
  await messenger.undoOverlay.showComposeWindow(item.windowId);
  await startNext();
}

messenger.undoOverlay.onUndo.addListener(undoActive);
messenger.undoOverlay.onSendNow.addListener(() => {
  sendActive();
});

// 5) Verfassen-Fenster auf anderem Weg geschlossen → aus Warteschlange entfernen
messenger.tabs.onRemoved.addListener(async tabId => {
  const before = queue.length;
  queue = queue.filter(i => i.tabId !== tabId);
  if (active && active.tabId === tabId && !sending) {
    active = null;
    await startNext();
    return;
  }
  if (queue.length !== before) {
    await syncPending();
    await messenger.undoOverlay.updateQueued(queue.length);
  }
});

// 6) Betterbird wird beendet/Hauptfenster geschlossen → alles als Entwurf sichern
messenger.undoOverlay.onShutdownRequested.addListener(async kind => {
  shuttingDown = true;
  clearTimer();
  if (sending && sendPromise) {
    await sendPromise; // laufenden Versand abwarten, nicht als Entwurf sichern
  }
  const items = [...(active ? [active] : []), ...queue];
  active = null;
  queue = [];
  await messenger.undoOverlay.hideOverlay();

  for (const item of items) {
    try {
      await messenger.compose.saveMessage(item.tabId, { mode: "draft" });
      await messenger.windows.remove(item.windowId);
    } catch (e) {
      console.error("NovaBird-Send: Entwurf speichern fehlgeschlagen", e);
      await messenger.undoOverlay.showComposeWindow(item.windowId);
    }
  }
  await syncPending();
  shuttingDown = false;
  await messenger.undoOverlay.proceedShutdown(kind);
});

// 7) Einstellungen ändern sich → Aussehen sofort übernehmen
messenger.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    applyStyle().catch(e => console.error("NovaBird-Send: Stil setzen fehlgeschlagen", e));
  }
});
applyStyle().catch(e => console.error("NovaBird-Send: Stil setzen fehlgeschlagen", e));
applyStrings().catch(e => console.error("NovaBird-Send: Texte setzen fehlgeschlagen", e));

// 8) Vorschau aus der Optionsseite: Overlay kurz mit Beispieldaten zeigen
const PREVIEW_SECONDS = 8;
let previewTimer = null;

messenger.runtime.onMessage.addListener(message => {
  // Optionsseite: fertige Farbpalette für die Live-Vorschau (mit noch ungespeicherten Werten)
  if (message?.type === "palette") {
    return computePalette(sanitizeSettings(message.settings));
  }
  if (message?.type !== "preview" || active || sending) {
    return;
  }
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    previewTimer = null;
    if (!active) {
      messenger.undoOverlay.hideOverlay();
    }
  }, PREVIEW_SECONDS * 1000);
  return messenger.undoOverlay.showOverlay({
    subject: i18n("previewSubject"),
    seconds: PREVIEW_SECONDS,
    queued: 1,
  });
});
