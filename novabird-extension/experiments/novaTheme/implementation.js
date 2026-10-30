/* NovaBird-Themes (Sand, Cobalt, Springlight) in der Extension – privilegiert.
 *  Die WebExtension-API theme.update kennt nur einen Farbsatz und das Stylesheet aus dem eigenen Manifest. Ein Theme braucht
 *  aber hell und dunkel (nach dem Modus des Betriebssystems) und je ein eigenes Stylesheet. Daher werden die Theme-Daten hier
 *  genauso aufbereitet wie bei einem installierten Theme (LightweightThemeManager.themeDataFrom) und an alle Fenster gemeldet;
 *  neue Fenster übernehmen sie über fallbackThemeData.
 *  "restore" gibt das Aussehen an das im Add-ons-Manager aktive Theme zurück (dessen beim Start gespeicherte Theme-Daten).
 *  Außerdem: Umstieg von den früheren Theme-Add-ons (novabird-t-*), die jetzt in der Extension stecken.
 * In einer IIFE gekapselt, weil alle Experimente dieses Add-ons einen globalen Scope teilen.
 */
"use strict";
this.novaTheme = (() => {

const { ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
const { LightweightThemeManager } = ChromeUtils.importESModule("resource://gre/modules/LightweightThemeManager.sys.mjs");

const LEGACY = ["novabird-t-sand@novabird", "novabird-t-cobalt@novabird", "novabird-t-springlight@novabird"];
let applied = false; // ein NovaBird-Theme ist gerade von uns gesetzt

function publish(lwtData) {
  LightweightThemeManager.fallbackThemeData = lwtData; // für neue Fenster
  Services.obs.notifyObservers(lwtData, "lightweight-theme-styling-update");
}

// Theme-Daten des im Add-ons-Manager aktiven Themes (wie beim Start gespeichert); ohne sie: kein Theme (Standardaussehen)
async function restoreStatic() {
  let data = null;
  try {
    const active = (await AddonManager.getAddonsByTypes(["theme"])).find(a => a.isActive);
    const ext = active && ExtensionParent.GlobalManager.getExtension(active.id);
    data = ext?.startupData?.lwtData || null;
  } catch (e) {
    console.error("NovaBird-Extension: aktives Theme", e);
  }
  publish(data && data.dataVersion === LightweightThemeManager.DATA_VERSION ? data : { theme: null });
}

const API = class extends ExtensionCommon.ExtensionAPI {
  onShutdown(isAppShutdown) {
    if (!isAppShutdown && applied) {
      applied = false;
      restoreStatic();
    }
  }

  getAPI(context) {
    const { extension } = context;
    return {
      novaTheme: {
        async apply(theme, darkTheme, stylesheet) {
          if (typeof LightweightThemeManager.themeDataFrom !== "function") {
            throw new Error("themeDataFrom fehlt in dieser Thunderbird-Version");
          }
          // Wie bei einem installierten Theme: Stylesheet über die Datei-URL des Pakets (moz-extension:// ist für Chrome-Stylesheets gesperrt)
          const lwtData = LightweightThemeManager.themeDataFrom(
            theme, darkTheme, { stylesheet: String(stylesheet) }, extension.rootURI, extension.id, extension.version, extension.logger
          );
          applied = true;
          publish(lwtData);
          return true;
        },
        async restore() {
          if (!applied) {
            return false;
          }
          applied = false;
          await restoreStatic();
          return true;
        },
        async legacyThemes() {
          const list = await AddonManager.getAddonsByIDs(LEGACY);
          return list.filter(Boolean).map(a => ({ id: a.id, active: Boolean(a.isActive) }));
        },
        async removeLegacyThemes() {
          const removed = [];
          for (const addon of (await AddonManager.getAddonsByIDs(LEGACY)).filter(Boolean)) {
            try {
              await addon.uninstall();
              removed.push(addon.id);
            } catch (e) {
              console.error("NovaBird-Extension: altes Theme entfernen", addon.id, e);
            }
          }
          return removed;
        },
      },
    };
  }
};
return API;
})();
