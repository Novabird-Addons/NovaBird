/* Umstieg auf NovaBird-Search 2.0 – privilegiert.
 *  Bis 1.x waren Suchleiste (novabird-search@novabird) und Suchindex (novabird-db@novabird) zwei Add-ons. Das gemeinsame Add-on
 *  hat die ID des Index; die Einstellungen der alten Suchleiste liegen aber im storage.local des alten Add-ons. Sie werden hier
 *  einmal gelesen (gleicher Speicherort wie bei storage.local: IndexedDB mit dem Speicher-Principal des Add-ons), danach wird
 *  das alte Add-on entfernt, damit nicht zwei Suchleisten laufen.
 * In einer IIFE gekapselt, weil alle Experimente dieses Add-ons einen globalen Scope teilen.
 */
"use strict";
var searchMigrate = (() => {

const { ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
const { ExtensionStorageIDB } = ChromeUtils.importESModule("resource://gre/modules/ExtensionStorageIDB.sys.mjs");

const OLD_ID = "novabird-search@novabird";
const STORAGE_USER_CONTEXT_ID = -1 >>> 0; // wie WEBEXT_STORAGE_USER_CONTEXT_ID in ExtensionStorageIDB

function oldUuid() {
  try {
    return JSON.parse(Services.prefs.getStringPref("extensions.webextensions.uuids", "{}"))[OLD_ID] || null;
  } catch {
    return null;
  }
}

return class extends ExtensionCommon.ExtensionAPI {
  getAPI() {
    return {
      searchMigrate: {
        async legacy() {
          const addon = await AddonManager.getAddonByID(OLD_ID);
          return { installed: Boolean(addon), version: addon?.version || null, active: Boolean(addon?.isActive) };
        },
        async readLegacyStorage(keys) {
          const uuid = oldUuid();
          if (!uuid) {
            return {};
          }
          const principal = Services.scriptSecurityManager.createContentPrincipal(
            Services.io.newURI(`moz-extension://${uuid}/`), { userContextId: STORAGE_USER_CONTEXT_ID }
          );
          const db = await ExtensionStorageIDB.open(principal);
          const data = await db.get(keys);
          // nur einfache Daten weitergeben (Einstellungen, Verlauf)
          return JSON.parse(JSON.stringify(data || {}));
        },
        async removeLegacy() {
          const addon = await AddonManager.getAddonByID(OLD_ID);
          if (!addon) {
            return false;
          }
          await addon.uninstall();
          return true;
        },
      },
    };
  }
};
})();
