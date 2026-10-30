/* Online-Updates – Teil der NovaBird-Extension, privilegiert. Nur aktiv, wenn der Nutzer den Reiter „Online-Updates“ einschaltet.
 *  - liest die Kanal-Datei (stable/testing) aus dem Update-Repo auf GitHub,
 *  - meldet die installierten Versionen der NovaBird-Add-ons,
 *  - installiert ein Paket über den AddonManager; Thunderbird prüft dabei die SHA-256-Prüfsumme aus der Kanal-Datei.
 *  Erlaubt sind nur die acht NovaBird-IDs und nur Adressen des Update-Repos (fest im Code). Nur zum Testen kann die Einstellung
 *  extensions.novabird.updates.testBase auf einen Server auf diesem Rechner (http://127.0.0.1:…/) zeigen.
 * In einer IIFE gekapselt, weil alle Experimente dieses Add-ons einen globalen Scope teilen.
 */
"use strict";
this.onlineUpdates = (() => {

const { ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");

const REPO = "Novabird-Addons/Nova-Bird-Online-Updates";
const CHANNELS = ["stable", "testing"];
// Ab NovaBird 2.0 vier Add-ons: Search und DB sind eins (ID von DB), die Themes stecken in der Extension
const IDS = ["novabird-extension@novabird", "novabird-db@novabird", "novabird-conversation@novabird", "novabird-send@novabird"];
const TEST_PREF = "extensions.novabird.updates.testBase";

function bases() {
  const test = Services.prefs.getCharPref(TEST_PREF, "");
  if (/^http:\/\/(127\.0\.0\.1|localhost):\d+\/$/.test(test)) {
    return { channel: test + "channels/", download: test };
  }
  return {
    channel: `https://raw.githubusercontent.com/${REPO}/main/channels/`,
    download: `https://github.com/${REPO}/releases/download/`,
  };
}

const VERSION = /^\d+(\.\d+){0,3}$/;
const SHA = /^[0-9a-f]{64}$/;

function validEntry(a, downloadBase) {
  return a && IDS.includes(a.id) && VERSION.test(a.version || "") && SHA.test(a.sha256 || "")
    && typeof a.url === "string" && a.url.startsWith(downloadBase) && !a.url.includes("..")
    && ["extension", "theme"].includes(a.type);
}

async function fetchChannel(channel) {
  if (!CHANNELS.includes(channel)) {
    throw new Error("unbekannter Kanal");
  }
  const b = bases();
  // fetch gibt es im Experiment-Bereich nicht immer; sonst das des Hauptfensters (privilegiert, keine Host-Rechte nötig)
  const doFetch = typeof fetch === "function" ? fetch : (...a) => Services.wm.getMostRecentWindow("mail:3pane").fetch(...a);
  const res = await doFetch(`${b.channel}${channel}.json?t=${Date.now()}`, { cache: "no-store", credentials: "omit" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = await res.json();
  if (data?.schema !== 1 || !Array.isArray(data.addons)) {
    throw new Error("Kanal-Datei unbekanntes Format");
  }
  const addons = data.addons.filter(a => validEntry(a, b.download)).map(a => ({
    id: a.id, version: a.version, type: a.type, url: a.url, sha256: a.sha256,
    minApp: VERSION.test(a.minApp || "") ? a.minApp : "", size: Number(a.size) || 0,
  }));
  return { channel, built: String(data.built || ""), commit: String(data.commit || "").slice(0, 40), addons };
}

async function getInstalled() {
  const list = await AddonManager.getAddonsByIDs(IDS);
  return list.filter(Boolean).map(a => ({ id: a.id, version: a.version, type: a.type, active: a.isActive, name: a.name }));
}

async function install(entry) {
  const b = bases();
  if (!validEntry(entry, b.download)) {
    return { ok: false, error: "ungültiger Eintrag" };
  }
  // Ein neu installiertes Theme schaltet Thunderbird sofort ein; das bisher aktive bleibt aktiv
  const before = entry.type === "theme" ? await AddonManager.getAddonsByTypes(["theme"]) : [];
  const activeTheme = before.find(t => t.isActive);
  const wasInstalled = before.some(t => t.id === entry.id);
  const inst = await AddonManager.getInstallForURL(entry.url, {
    hash: `sha256:${entry.sha256}`,
    name: entry.id,
    version: entry.version,
    telemetryInfo: { source: "novabird-online-updates" },
  });
  const result = await new Promise(resolve => {
    // AddonManager-Fehlercodes lesbar machen (-1 Netz, -2 Prüfsumme, -3 Paket beschädigt)
    const why = { "-1": "Netzwerkfehler", "-2": "Prüfsumme stimmt nicht", "-3": "Paket beschädigt", "-4": "Dateizugriff" };
    const fail = what => () => resolve({ ok: false, error: `${what}: ${why[String(inst.error)] || inst.error || "?"}` });
    inst.addListener({
      onDownloadFailed: fail("Download fehlgeschlagen"),
      onDownloadCancelled: fail("Download abgebrochen"),
      onInstallFailed: fail("Installation fehlgeschlagen"),
      onInstallCancelled: fail("Installation abgebrochen"),
      onInstallEnded: (_i, addon) => resolve({ ok: true, version: addon?.version || entry.version }),
    });
    inst.install();
  });
  if (result.ok && entry.type === "theme" && !wasInstalled && activeTheme && activeTheme.id !== entry.id) {
    try {
      await activeTheme.enable();
    } catch (e) {
      console.error("NovaBird Online-Updates: Theme zurück", e);
    }
  }
  return result;
}

const API = class extends ExtensionCommon.ExtensionAPI {
  getAPI() {
    return {
      onlineUpdates: {
        async fetchChannel(channel) {
          return fetchChannel(channel);
        },
        async getInstalled() {
          return getInstalled();
        },
        async install(entry) {
          try {
            return await install(entry);
          } catch (e) {
            return { ok: false, error: String(e?.message || e) };
          }
        },
        async appVersion() {
          return Services.appinfo.version;
        },
        async restart() {
          Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart);
        },
      },
    };
  }
};

return API;
})();
