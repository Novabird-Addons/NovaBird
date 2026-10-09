/* Logiktests für background.js mit nachgebauter messenger-API und manueller Uhr.
 * Ausführen: node --test tests/
 * Nicht ins XPI packen (nur Entwicklung).
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = name => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
const SETTINGS_SOURCE = read("settings.js");
const SOURCE = read("background.js");

// Mehrere Durchläufe, weil die Attrappe selbst verschachtelt wartet.
const flush = async () => {
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
};
// Objekte aus der vm haben einen anderen Prototyp; für Vergleiche normalisieren.
const plain = v => JSON.parse(JSON.stringify(v ?? null));

// Nachbau von i18n.getMessage auf Basis der echten _locales-Dateien (inkl. Platzhalter)
function makeGetMessage(locale) {
  const messages = JSON.parse(read(`_locales/${locale}/messages.json`));
  return (key, substitutions) => {
    const entry = messages[key];
    if (!entry) {
      return "";
    }
    const subs = [].concat(substitutions ?? []);
    return entry.message.replace(/\$(\w+)\$/g, (_, name) => {
      const content = entry.placeholders?.[name.toLowerCase()]?.content ?? "";
      return content.replace(/\$(\d)/g, (__, i) => subs[Number(i) - 1] ?? "");
    });
  };
}

async function setup({ delay = 10, locale = "de" } = {}) {
  // --- manuelle Uhr ---
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const fakeSetTimeout = (fn, ms) => {
    const id = nextId++;
    timers.set(id, { fn, at: now + ms });
    return id;
  };
  const fakeClearTimeout = id => timers.delete(id);
  const advance = async ms => {
    const target = now + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) {
        break;
      }
      now = due[1].at;
      timers.delete(due[0]);
      due[1].fn();
      await flush();
    }
    now = target;
    await flush();
  };

  // --- Attrappe der API ---
  const log = []; // Reihenfolge aller relevanten Aufrufe
  const listeners = {};
  const ev = name => ({
    addListener: fn => {
      (listeners[name] ||= []).push(fn);
    },
  });
  const fireRaw = async (name, ...args) => {
    const results = [];
    for (const fn of listeners[name] || []) {
      results.push(await fn(...args));
    }
    return results[0];
  };
  // Für Testaufrufe von außen: danach alles Ausstehende abarbeiten.
  const fire = async (name, ...args) => {
    const result = await fireRaw(name, ...args);
    await flush();
    return result;
  };

  const mocks = {
    sendBehavior: async () => ({ messages: [], mode: "sendNow" }),
    saveBehavior: async () => ({ messages: [], mode: "draft" }),
    delay,
    noticeFails: false,
    theme: { bg: "rgb(230, 236, 245)", fg: "rgb(30, 40, 56)", border: "rgb(210, 218, 230)", accent: "rgb(47, 107, 216)" },
    settings: {}, // überschreibt Standardwerte aus storage.local
    sendInfo: { deliverMode: 0, offline: false },
  };
  const windows = new Map(); // tabId -> windowId

  const messenger = {
    storage: {
      local: { get: async defaults => ({ ...defaults, delay: mocks.delay, ...mocks.settings }) },
      onChanged: ev("storageChanged"),
    },
    runtime: { onMessage: ev("message") },
    i18n: { getMessage: makeGetMessage(locale) },
    compose: {
      onBeforeSend: ev("beforeSend"),
      // Wie in Thunderbird: sendMessage löst onBeforeSend erneut aus.
      sendMessage: async (tabId, opts) => {
        log.push(["sendMessage", tabId, opts.mode]);
        const r = await fireRaw("beforeSend", { id: tabId, windowId: windows.get(tabId) }, { subject: "x" });
        if (r?.cancel) {
          return { error: "abgebrochen" };
        }
        const result = await mocks.sendBehavior(tabId);
        if (!result.error) {
          await fireRaw("tabRemoved", tabId); // Fenster schließt sich nach Versand
        }
        return result;
      },
      saveMessage: async (tabId, opts) => {
        log.push(["saveMessage", tabId, opts.mode]);
        return mocks.saveBehavior(tabId);
      },
    },
    tabs: { onRemoved: ev("tabRemoved") },
    windows: {
      remove: async windowId => {
        log.push(["windows.remove", windowId]);
      },
    },
    undoOverlay: {
      onUndo: ev("undo"),
      onSendNow: ev("sendNow"),
      onShutdownRequested: ev("shutdown"),
      setPendingCount: async n => log.push(["pending", n]),
      getSendInfo: async () => ({ ...mocks.sendInfo }),
      hideComposeWindow: async w => log.push(["hide", w]),
      showComposeWindow: async w => log.push(["show", w]),
      getThemeColors: async () => mocks.theme,
      setStyle: async s => log.push(["style", plain(s)]),
      setStrings: async s => log.push(["strings", plain(s)]),
      showNotice: async d => {
        log.push(["notice", d.subject, d.text]);
        if (mocks.noticeFails) {
          throw new Error("kein Fenster");
        }
      },
      showOverlay: async d => log.push(["overlay", d.subject, d.seconds, d.queued]),
      setSending: async () => log.push(["setSending"]),
      updateQueued: async n => log.push(["queued", n]),
      hideOverlay: async () => log.push(["hideOverlay"]),
      proceedShutdown: async k => log.push(["proceedShutdown", k]),
    },
  };

  const context = vm.createContext({
    messenger,
    console: { ...console, error: () => {} }, // erwartete Fehlerausgaben unterdrücken
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
  });
  vm.runInContext(SETTINGS_SOURCE, context, { filename: "settings.js" });
  vm.runInContext(SOURCE, context, { filename: "background.js" });
  await flush(); // Start-Aufrufe (Stil setzen) abwarten

  /** Simuliert Klick auf „Senden“ in einem Verfassen-Fenster. */
  const clickSend = async (tabId, subject) => {
    windows.set(tabId, tabId * 100);
    return fire("beforeSend", { id: tabId, windowId: tabId * 100 }, { subject });
  };

  const calls = name => log.filter(e => e[0] === name);
  const sanitize = raw => plain(vm.runInContext("sanitizeSettings", context)(raw));
  return { log, calls, mocks, fire, advance, clickSend, sanitize };
}

test("Einzelne Mail: Senden wird abgefangen, nach Ablauf gesendet", async () => {
  const t = await setup();
  const result = await t.clickSend(1, "Hallo");
  assert.deepEqual(plain(result), { cancel: true });
  assert.deepEqual(t.calls("hide"), [["hide", 100]]);
  assert.deepEqual(t.calls("overlay"), [["overlay", "Hallo", 10, 0]]);

  await t.advance(9_000);
  assert.equal(t.calls("sendMessage").length, 0, "vor Ablauf nicht senden");

  await t.advance(1_000);
  assert.deepEqual(t.calls("sendMessage"), [["sendMessage", 1, "sendNow"]]);
  assert.equal(t.calls("show").length, 0, "Fenster bleibt versteckt/schließt sich");
  assert.equal(t.log.at(-2)[0], "pending");
  assert.deepEqual(t.log.at(-2), ["pending", 0]);
  assert.deepEqual(t.log.at(-1), ["hideOverlay"]);
});

test("Leerer Betreff wird ersetzt", async () => {
  const t = await setup();
  await t.clickSend(1, "   ");
  assert.equal(t.calls("overlay")[0][1], "(Kein Betreff)");
});

test("Rückgängig: Fenster wieder sichtbar, nichts gesendet", async () => {
  const t = await setup();
  await t.clickSend(1, "Hallo");
  await t.advance(3_000);
  await t.fire("undo");
  assert.deepEqual(t.calls("show"), [["show", 100]]);
  assert.deepEqual(t.calls("hideOverlay"), [["hideOverlay"]]);
  await t.advance(60_000);
  assert.equal(t.calls("sendMessage").length, 0);
});

test("Erneutes Senden nach Rückgängig funktioniert", async () => {
  const t = await setup();
  await t.clickSend(1, "Hallo");
  await t.fire("undo");
  await t.clickSend(1, "Hallo");
  await t.advance(10_000);
  assert.equal(t.calls("sendMessage").length, 1);
});

test("Jetzt senden: sofort gesendet, Timer feuert nicht doppelt", async () => {
  const t = await setup();
  await t.clickSend(1, "Hallo");
  await t.advance(2_000);
  await t.fire("sendNow");
  assert.equal(t.calls("sendMessage").length, 1);
  await t.advance(60_000);
  assert.equal(t.calls("sendMessage").length, 1);
});

test("Doppelklick auf „Jetzt senden“ sendet nur einmal", async () => {
  const t = await setup();
  await t.clickSend(1, "Hallo");
  t.mocks.sendBehavior = async () => {
    await flush();
    await flush();
    return { messages: [], mode: "sendNow" };
  };
  await Promise.all([t.fire("sendNow"), t.fire("sendNow")]);
  assert.equal(t.calls("sendMessage").length, 1);
});

test("Rückgängig während des Versands wird ignoriert", async () => {
  const t = await setup();
  await t.clickSend(1, "Hallo");
  let release;
  t.mocks.sendBehavior = () => new Promise(resolve => (release = () => resolve({ messages: [] })));
  t.fire("sendNow");
  await flush();
  await t.fire("undo");
  assert.equal(t.calls("show").length, 0);
  release();
  await flush();
});

test("Drei Mails: FIFO, Countdown startet erst nach der vorherigen", async () => {
  const t = await setup();
  await t.clickSend(1, "Eins");
  await t.clickSend(2, "Zwei");
  await t.clickSend(3, "Drei");

  assert.deepEqual(t.calls("overlay"), [["overlay", "Eins", 10, 0]]);
  assert.deepEqual(t.calls("queued").at(-1), ["queued", 2]);
  assert.deepEqual(t.calls("pending").at(-1), ["pending", 3]);

  await t.advance(10_000);
  assert.deepEqual(t.calls("sendMessage").map(c => c[1]), [1]);
  assert.deepEqual(t.calls("overlay").at(-1), ["overlay", "Zwei", 10, 1]);

  await t.advance(9_999);
  assert.equal(t.calls("sendMessage").length, 1, "Zwei hat volle 10 s");
  await t.advance(1);
  assert.deepEqual(t.calls("sendMessage").map(c => c[1]), [1, 2]);

  await t.advance(10_000);
  assert.deepEqual(t.calls("sendMessage").map(c => c[1]), [1, 2, 3]);
  assert.deepEqual(t.log.at(-1), ["hideOverlay"]);
});

test("Rückgängig bei der ersten Mail startet die zweite", async () => {
  const t = await setup();
  await t.clickSend(1, "Eins");
  await t.clickSend(2, "Zwei");
  await t.fire("undo");
  assert.deepEqual(t.calls("show"), [["show", 100]]);
  assert.deepEqual(t.calls("overlay").at(-1), ["overlay", "Zwei", 10, 0]);
  await t.advance(10_000);
  assert.deepEqual(t.calls("sendMessage").map(c => c[1]), [2]);
});

test("Mail kommt während eines laufenden Versands dazu", async () => {
  const t = await setup();
  await t.clickSend(1, "Eins");
  let release;
  t.mocks.sendBehavior = tabId =>
    new Promise(resolve => {
      release = () => resolve({ messages: [], tabId });
    });
  t.fire("sendNow");
  await flush();
  await t.clickSend(2, "Zwei");
  assert.equal(t.calls("sendMessage").length, 1);
  t.mocks.sendBehavior = async () => ({ messages: [] });
  release();
  await flush();
  assert.deepEqual(t.calls("overlay").at(-1), ["overlay", "Zwei", 10, 0]);
});

test("Versandfehler als Rückgabewert: Fenster kommt zurück, nächste Mail läuft", async () => {
  const t = await setup();
  t.mocks.sendBehavior = async () => ({ error: "Server nicht erreichbar" });
  await t.clickSend(1, "Eins");
  await t.clickSend(2, "Zwei");
  await t.advance(10_000);
  assert.deepEqual(t.calls("show"), [["show", 100]]);
  assert.deepEqual(t.calls("overlay").at(-1), ["overlay", "Zwei", 10, 0]);
});

test("Versandfehler als Exception: Fenster kommt zurück", async () => {
  const t = await setup();
  t.mocks.sendBehavior = async () => {
    throw new Error("kaputt");
  };
  await t.clickSend(1, "Eins");
  await t.advance(10_000);
  assert.deepEqual(t.calls("show"), [["show", 100]]);
});

test("Nach Fehler kann dieselbe Mail erneut gesendet werden (approved wird geleert)", async () => {
  const t = await setup();
  t.mocks.sendBehavior = async () => ({ error: "weg" });
  await t.clickSend(1, "Eins");
  await t.advance(10_000);
  const again = await t.clickSend(1, "Eins");
  assert.deepEqual(plain(again), { cancel: true }, "erneut abgefangen, nicht durchgewunken");
});

test("Verzögerung kommt aus den Einstellungen", async () => {
  const t = await setup({ delay: 25 });
  await t.clickSend(1, "Hallo");
  assert.deepEqual(t.calls("overlay")[0], ["overlay", "Hallo", 25, 0]);
  await t.advance(24_999);
  assert.equal(t.calls("sendMessage").length, 0);
  await t.advance(1);
  assert.equal(t.calls("sendMessage").length, 1);
});

test("Wartendes Fenster wird extern geschlossen: aus Warteschlange entfernt", async () => {
  const t = await setup();
  await t.clickSend(1, "Eins");
  await t.clickSend(2, "Zwei");
  await t.fire("tabRemoved", 2);
  assert.deepEqual(t.calls("queued").at(-1), ["queued", 0]);
  await t.advance(10_000);
  assert.deepEqual(t.calls("sendMessage").map(c => c[1]), [1]);
  assert.deepEqual(t.log.at(-1), ["hideOverlay"]);
});

test("Aktives Fenster wird extern geschlossen: nächste Mail startet", async () => {
  const t = await setup();
  await t.clickSend(1, "Eins");
  await t.clickSend(2, "Zwei");
  await t.fire("tabRemoved", 1);
  assert.deepEqual(t.calls("overlay").at(-1), ["overlay", "Zwei", 10, 0]);
  await t.advance(10_000);
  assert.deepEqual(t.calls("sendMessage").map(c => c[1]), [2]);
});

test("Beenden während Countdown: alle als Entwurf, dann Beenden fortsetzen", async () => {
  const t = await setup();
  await t.clickSend(1, "Eins");
  await t.clickSend(2, "Zwei");
  await t.clickSend(3, "Drei");
  await t.advance(4_000);
  await t.fire("shutdown", "quit");

  assert.deepEqual(t.calls("saveMessage").map(c => [c[1], c[2]]), [[1, "draft"], [2, "draft"], [3, "draft"]]);
  assert.deepEqual(t.calls("windows.remove").map(c => c[1]), [100, 200, 300]);
  assert.equal(t.calls("sendMessage").length, 0);
  assert.deepEqual(t.log.at(-1), ["proceedShutdown", "quit"]);
  assert.deepEqual(t.calls("pending").at(-1), ["pending", 0]);

  await t.advance(60_000);
  assert.equal(t.calls("sendMessage").length, 0, "Timer wurde gestoppt");
});

test("Schließen des letzten Hauptfensters meldet kind=close", async () => {
  const t = await setup();
  await t.clickSend(1, "Eins");
  await t.fire("shutdown", "close");
  assert.deepEqual(t.log.at(-1), ["proceedShutdown", "close"]);
});

test("Beenden während des Versands: wartet ab, sichert nur die übrigen", async () => {
  const t = await setup();
  await t.clickSend(1, "Eins");
  await t.clickSend(2, "Zwei");
  let release;
  t.mocks.sendBehavior = () => new Promise(resolve => (release = () => resolve({ messages: [] })));
  t.fire("sendNow");
  await flush();

  const shutdown = t.fire("shutdown", "quit");
  await flush();
  assert.equal(t.calls("proceedShutdown").length, 0, "wartet auf Versand");
  assert.equal(t.calls("saveMessage").length, 0);

  release();
  await shutdown;
  await flush();

  assert.deepEqual(t.calls("saveMessage").map(c => c[1]), [2], "Mail 1 wurde gesendet, nicht gesichert");
  assert.equal(t.calls("overlay").filter(o => o[1] === "Zwei").length, 0, "Countdown von Zwei startet nicht");
  assert.deepEqual(t.log.at(-1), ["proceedShutdown", "quit"]);

  await t.advance(60_000);
  assert.deepEqual(t.calls("sendMessage").map(c => c[1]), [1], "nach dem Sichern wird nichts mehr gesendet");
});

test("Beenden: Entwurf speichern schlägt fehl → Fenster bleibt sichtbar, Beenden läuft weiter", async () => {
  const t = await setup();
  await t.clickSend(1, "Eins");
  t.mocks.saveBehavior = async () => {
    throw new Error("Speichern nicht möglich");
  };
  await t.fire("shutdown", "quit");
  assert.deepEqual(t.calls("show"), [["show", 100]]);
  assert.equal(t.calls("windows.remove").length, 0, "Fenster nicht schließen, wenn Sichern fehlschlug");
  assert.deepEqual(t.log.at(-1), ["proceedShutdown", "quit"]);
});

test("Nach abgebrochenem Beenden (close) funktioniert die Warteschlange wieder", async () => {
  const t = await setup();
  await t.clickSend(1, "Eins");
  await t.fire("shutdown", "close");
  await t.clickSend(2, "Zwei");
  assert.deepEqual(t.calls("overlay").at(-1), ["overlay", "Zwei", 10, 0]);
  await t.advance(10_000);
  assert.deepEqual(t.calls("sendMessage").map(c => c[1]), [2]);
});

test("„Später senden“ wird nicht abgefangen", async () => {
  const t = await setup();
  t.mocks.sendInfo = { deliverMode: 1, offline: false };
  const result = await t.clickSend(1, "Hallo");
  assert.deepEqual(plain(result), {});
  assert.equal(t.calls("hide").length, 0);
  assert.equal(t.calls("overlay").length, 0);
  await t.advance(60_000);
  assert.equal(t.calls("sendMessage").length, 0);
});

test("Unbekannter Sendemodus (null) wird normal abgefangen", async () => {
  const t = await setup();
  t.mocks.sendInfo = { deliverMode: null, offline: false };
  const result = await t.clickSend(1, "Hallo");
  assert.deepEqual(plain(result), { cancel: true });
});

test("Offline beim Klick auf Senden: nicht eingreifen", async () => {
  const t = await setup();
  t.mocks.sendInfo = { deliverMode: 0, offline: true };
  const result = await t.clickSend(1, "Hallo");
  assert.deepEqual(plain(result), {});
  assert.equal(t.calls("hide").length, 0);
  assert.equal(t.calls("overlay").length, 0);
});

test("Offline geworden während des Countdowns: Fenster kommt zurück, nichts gesendet", async () => {
  const t = await setup();
  await t.clickSend(1, "Eins");
  await t.clickSend(2, "Zwei");
  t.mocks.sendInfo = { deliverMode: 0, offline: true };
  await t.advance(10_000);
  assert.equal(t.calls("sendMessage").length, 0);
  assert.deepEqual(t.calls("show"), [["show", 100]]);
  assert.deepEqual(t.calls("overlay").at(-1), ["overlay", "Zwei", 10, 0], "Warteschlange läuft weiter");
});

test("Hängender Versand: nach 20 s wird das Fenster wieder gezeigt", async () => {
  const t = await setup();
  await t.clickSend(1, "Eins");
  let release;
  t.mocks.sendBehavior = () => new Promise(resolve => (release = () => resolve({ messages: [] })));
  await t.advance(10_000);
  assert.equal(t.calls("show").length, 0);
  await t.advance(19_999);
  assert.equal(t.calls("show").length, 0);
  await t.advance(1);
  assert.deepEqual(t.calls("show"), [["show", 100]]);
  release();
  await flush();
});

test("Normaler Versand: Absicherung zeigt das Fenster nie", async () => {
  const t = await setup();
  await t.clickSend(1, "Eins");
  await t.advance(10_000);
  await t.advance(60_000);
  assert.equal(t.calls("show").length, 0);
});

test("Offline während des Countdowns: Hinweis mit Betreff wird angezeigt", async () => {
  const t = await setup();
  await t.clickSend(1, "Quartalsbericht");
  t.mocks.sendInfo = { deliverMode: 0, offline: true };
  await t.advance(10_000);
  const notices = t.calls("notice");
  assert.equal(notices.length, 1);
  assert.equal(notices[0][1], "Quartalsbericht");
  assert.match(notices[0][2], /Keine Verbindung/);
  const showIdx = t.log.findIndex(e => e[0] === "show");
  assert.ok(showIdx < t.log.findIndex(e => e[0] === "notice"), "erst Fenster zeigen, dann Hinweis");
});

test("Versandfehler: Hinweis enthält die Fehlermeldung", async () => {
  const t = await setup();
  t.mocks.sendBehavior = async () => ({ error: "Server nicht erreichbar" });
  await t.clickSend(1, "Eins");
  await t.advance(10_000);
  assert.match(t.calls("notice")[0][2], /Senden fehlgeschlagen: Server nicht erreichbar/);
});

test("Fehlgeschlagener Hinweis blockiert die Warteschlange nicht", async () => {
  const t = await setup();
  t.mocks.noticeFails = true;
  t.mocks.sendBehavior = async () => ({ error: "weg" });
  await t.clickSend(1, "Eins");
  await t.clickSend(2, "Zwei");
  await t.advance(10_000);
  assert.deepEqual(t.calls("overlay").at(-1), ["overlay", "Zwei", 10, 0]);
});

test("Rückgängig und erfolgreicher Versand zeigen keinen Hinweis", async () => {
  const t = await setup();
  await t.clickSend(1, "Eins");
  await t.fire("undo");
  await t.clickSend(2, "Zwei");
  await t.advance(10_000);
  assert.equal(t.calls("notice").length, 0);
});

const DEFAULT_STYLE = { size: "normal", horizontal: "center", bottom: 10, barHeight: 10, barStyle: "soft" };
const POLAR_PALETTE = {
  bg: "#e6ecf5", fg: "#1e2838", muted: "#6a7280", border: "#d2dae6", accent: "#2f6bd8",
  track: "#c5d5f0", undo: "#c9403d", onAccent: "#ffffff", onUndo: "#ffffff",
};
const DEFAULT_SETTINGS = {
  delay: 10, showNotices: true, ...DEFAULT_STYLE,
  colorMode: "theme", colorBg: "#e6ecf5", colorFg: "#1e2838", colorAccent: "#2f6bd8", colorUndo: "#c9403d", undoTone: "red",
};

test("Beim Start wird der Stil mit Standardwerten gesetzt", async () => {
  const t = await setup();
  assert.deepEqual(t.calls("style"), [["style", { ...DEFAULT_STYLE, palette: POLAR_PALETTE }]]);
});

test("Geänderte Einstellungen werden sofort übernommen, ungültige begrenzt", async () => {
  const t = await setup();
  t.mocks.settings = { size: "large", horizontal: "right", bottom: 99, barHeight: 2, barStyle: "classic" };
  await t.fire("storageChanged", {}, "local");
  const { palette, ...rest } = t.calls("style").at(-1)[1];
  assert.deepEqual(rest, { size: "large", horizontal: "right", bottom: 40, barHeight: 4, barStyle: "classic" });
  assert.ok(palette.bg);
});

test("Änderungen in anderen Speicherbereichen werden ignoriert", async () => {
  const t = await setup();
  await t.fire("storageChanged", {}, "sync");
  assert.equal(t.calls("style").length, 1);
});

test("Hinweis bei Fehlern lässt sich abschalten", async () => {
  const t = await setup();
  t.mocks.settings = { showNotices: false };
  t.mocks.sendBehavior = async () => ({ error: "weg" });
  await t.clickSend(1, "Eins");
  await t.advance(10_000);
  assert.deepEqual(t.calls("show"), [["show", 100]], "Fenster kommt trotzdem zurück");
  assert.equal(t.calls("notice").length, 0);
});

test("Ungültige Verzögerung wird auf 3–60 s begrenzt", async () => {
  const t = await setup({ delay: 1 });
  await t.clickSend(1, "Hallo");
  assert.equal(t.calls("overlay")[0][2], 3);
  const u = await setup({ delay: 500 });
  await u.clickSend(1, "Hallo");
  assert.equal(u.calls("overlay")[0][2], 60);
});

test("sanitizeSettings: Standardwerte, Typen und Grenzen", async () => {
  const t = await setup();
  assert.deepEqual(t.sanitize({}), DEFAULT_SETTINGS);
  assert.deepEqual(t.sanitize(undefined), DEFAULT_SETTINGS);
  const bad = t.sanitize({
    delay: "abc", showNotices: "ja", size: "riesig", horizontal: "oben", bottom: -5, barHeight: "x", barStyle: "bunt",
    colorMode: "regenbogen", colorBg: "rot", colorFg: "#12", colorAccent: "url(x)", colorUndo: 5, undoTone: "blau",
  });
  assert.deepEqual(bad, { ...DEFAULT_SETTINGS, bottom: 0 });
  assert.equal(t.sanitize({ colorBg: "#ABCDEF" }).colorBg, "#abcdef", "Farben werden klein geschrieben");
  assert.equal(t.sanitize({ delay: "25" }).delay, 25);
});

test("Vorschau zeigt das Overlay und blendet es nach 8 s aus", async () => {
  const t = await setup();
  await t.fire("message", { type: "preview" });
  assert.deepEqual(t.calls("overlay"), [["overlay", "Vorschau – so sieht das Overlay aus", 8, 1]]);
  await t.advance(7_999);
  assert.equal(t.calls("hideOverlay").length, 0);
  await t.advance(1);
  assert.equal(t.calls("hideOverlay").length, 1);
});

test("Vorschau ignoriert fremde Nachrichten und läuft nicht neben einer echten Mail", async () => {
  const t = await setup();
  await t.fire("message", { type: "etwas-anderes" });
  assert.equal(t.calls("overlay").length, 0);
  await t.clickSend(1, "Echt");
  await t.fire("message", { type: "preview" });
  assert.equal(t.calls("overlay").length, 1, "nur das echte Overlay");
});

test("Echte Mail nach der Vorschau: Overlay wird nicht von der Vorschau ausgeblendet", async () => {
  const t = await setup();
  await t.fire("message", { type: "preview" });
  await t.advance(2_000);
  await t.clickSend(1, "Echt");
  const hidesBefore = t.calls("hideOverlay").length;
  await t.advance(6_000); // Vorschau-Timer läuft ab, echte Mail ist noch aktiv
  assert.equal(t.calls("hideOverlay").length, hidesBefore);
});

test("Texte des Overlays werden beim Start auf Deutsch gesetzt", async () => {
  const t = await setup();
  assert.deepEqual(t.calls("strings"), [[
    "strings",
    {
      waiting: "Wird gleich gesendet",
      sending: "Wird gesendet …",
      queued: "{n} weitere in Warteschlange",
      undo: "Rückgängig",
      sendNow: "Jetzt senden",
      ok: "OK",
    },
  ]]);
});

test("Texte des Overlays werden bei englischer Oberfläche auf Englisch gesetzt", async () => {
  const t = await setup({ locale: "en" });
  const strings = t.calls("strings")[0][1];
  assert.equal(strings.undo, "Undo");
  assert.equal(strings.sendNow, "Send now");
  assert.equal(strings.queued, "{n} more in queue");
});

test("Englisch: Betreff-Ersatz, Hinweise und Vorschau", async () => {
  const t = await setup({ locale: "en" });
  await t.clickSend(1, "   ");
  assert.equal(t.calls("overlay")[0][1], "(No subject)");

  t.mocks.sendInfo = { deliverMode: 0, offline: true };
  await t.advance(10_000);
  assert.match(t.calls("notice")[0][2], /^No connection/);

  const u = await setup({ locale: "en" });
  u.mocks.sendBehavior = async () => ({ error: "Server unreachable" });
  await u.clickSend(1, "Hi");
  await u.advance(10_000);
  assert.equal(
    u.calls("notice")[0][2],
    "Sending failed: Server unreachable. The compose window has been reopened."
  );

  const v = await setup({ locale: "en" });
  await v.fire("message", { type: "preview" });
  assert.match(v.calls("overlay")[0][1], /^Preview/);
});

test("Farbpalette: Theme-Farben werden übernommen", async () => {
  const t = await setup();
  assert.deepEqual(t.calls("style").at(-1)[1].palette, POLAR_PALETTE);
});

test("Farbpalette: dunkles Theme mit unlesbarer Schrift bekommt helle Schrift und hellen Rückgängig-Text", async () => {
  const t = await setup();
  t.mocks.theme = { bg: "rgb(29, 30, 34)", fg: "rgb(50, 50, 50)", border: "rgb(42, 44, 49)", accent: "rgb(91, 157, 255)" };
  await t.fire("storageChanged", {}, "local");
  const palette = t.calls("style").at(-1)[1].palette;
  assert.equal(palette.bg, "#1d1e22");
  assert.equal(palette.fg, "#ffffff", "Schrift wechselt auf Weiß");
  assert.equal(palette.undo, "#f27b7b", "helleres Rot auf dunklem Grund");
});

test("Farbpalette: eigene Farben und Akzentfarbe statt Rot", async () => {
  const t = await setup();
  t.mocks.settings = { colorMode: "custom", colorBg: "#102030", colorFg: "#f0f0f0", colorAccent: "#33aa55", undoTone: "accent" };
  await t.fire("storageChanged", {}, "local");
  const palette = t.calls("style").at(-1)[1].palette;
  assert.equal(palette.bg, "#102030");
  assert.equal(palette.accent, "#33aa55");
  assert.equal(palette.undo, "#33aa55", "Rückgängig in Akzentfarbe");
});

test("Theme-Farben nicht lesbar: Rückfallfarben, kein Absturz", async () => {
  const t = await setup();
  t.mocks.theme = null;
  await t.fire("storageChanged", {}, "local");
  assert.deepEqual(t.calls("style").at(-1)[1].palette, POLAR_PALETTE);
});

test("Optionsseite fragt Palette mit ungespeicherten Werten ab", async () => {
  const t = await setup();
  const palette = await t.fire("message", { type: "palette", settings: { colorMode: "custom", colorBg: "#000000", colorFg: "#ffffff", colorAccent: "#ff0000" } });
  assert.equal(palette.bg, "#000000");
  assert.equal(palette.accent, "#ff0000");
  assert.equal(t.calls("style").at(-1)[1].palette.bg, "#e6ecf5", "gespeicherte Werte bleiben unberührt");
});

test("Vor jedem Countdown wird das Theme neu eingelesen", async () => {
  const t = await setup();
  const before = t.calls("style").length;
  t.mocks.theme = { bg: "rgb(0, 0, 0)", fg: "rgb(255, 255, 255)", border: "rgb(40, 40, 40)", accent: "rgb(0, 128, 255)" };
  await t.clickSend(1, "Hallo");
  assert.equal(t.calls("style").length, before + 1);
  assert.equal(t.calls("style").at(-1)[1].palette.bg, "#000000");
  const styleIdx = t.log.map(e => e[0]).lastIndexOf("style");
  assert.ok(styleIdx < t.log.findIndex(e => e[0] === "overlay"), "Stil kommt vor dem Overlay");
});
