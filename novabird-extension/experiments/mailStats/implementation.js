/* Postfachanalyse – Teil der NovaBird-Extension, privilegiert, nur lesend.
 *  Liefert je Konto die Ordner mit Nachrichtenzahl und Größe auf der Festplatte, so wie Betterbird sie schon kennt
 *  (Ordnerzusammenfassung); es wird nichts geöffnet, nachgeladen oder verändert.
 * In einer IIFE gekapselt, weil alle Experimente dieses Add-ons einen globalen Scope teilen.
 */
"use strict";
this.mailStats = (() => {

const { ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");

function num(fn) {
  try {
    const v = fn();
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch (e) {
    return 0;
  }
}

function collect(folder, parents, out) {
  let subs = [];
  try { subs = [...folder.subFolders]; } catch (e) { return; }
  for (const sub of subs) {
    const label = sub.localizedName || sub.prettyName || sub.name || "";
    const path = [...parents, label];
    if (!sub.getFlag(Ci.nsMsgFolderFlags.Virtual)) {
      out.push({
        path: path.join("/"),
        name: label,
        count: num(() => sub.getTotalMessages(false)),
        unread: num(() => sub.getNumUnread(false)),
        size: num(() => sub.sizeOnDisk),
      });
    }
    collect(sub, path, out);
  }
}

const SELF_TEST = [
  { feature: "mailStats", test: () => typeof MailServices.accounts.accounts?.[Symbol.iterator] === "function" },
];

const API = class extends ExtensionCommon.ExtensionAPI {
  getAPI() {
    return {
      mailStats: {
        // [{id, name, type, folders: [{path, name, count, unread, size}]}], Größen in Byte
        async getStats() {
          const result = [];
          for (const account of MailServices.accounts.accounts) {
            const server = account.incomingServer;
            if (!server || server.hostName == "smart mailboxes") continue;
            const folders = [];
            collect(server.rootFolder, [], folders);
            if (!folders.length) continue;
            result.push({ id: account.key, name: server.prettyName, type: server.type, folders });
          }
          return result;
        },
        async selfTest() {
          const missing = [];
          for (const c of SELF_TEST) {
            try { if (!c.test()) missing.push(c.feature); } catch (e) { missing.push(c.feature); }
          }
          return { app: Services.appinfo.name, version: Services.appinfo.version, missing, pending: false };
        },
      },
    };
  }
};

return API;
})();
