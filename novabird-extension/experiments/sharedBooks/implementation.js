/* Geteilte Adressbücher – Experiment (privilegiert). Liest und schreibt die Adressbücher, die über den NovaBird Helper geteilt
 * werden (Abgleich in contacts/abshare.js): eigene lokale Adressbücher (Original beim Besitzer) und die Kopien geteilter
 * Adressbücher anderer PCs.
 *  - „Gesammelte Adressen“ (ldap_2.servers.history) und das Adressbuch, in das Thunderbird gerade sammelt (mail.collect_addressbook),
 *    werden nie geteilt; Online-Adressbücher (CardDAV, LDAP) auch nicht.
 *  - Kopie = lokales Adressbuch mit novabird.sharedBook = Kennung im Helper; readOnly, wenn die anderen nicht ändern dürfen.
 *  - Schreiben aus dem Abgleich ändert vorhandene Kontakte an Ort und Stelle: nur die vCard wird ersetzt, Thunderbirds eigene
 *    Angaben (z. B. Beliebtheit für die Adressvervollständigung) bleiben, und ein Foto bleibt, wenn die neue Fassung keins hat
 *    (Fotos als Datei werden nicht geteilt). Eigene Schreibvorgänge lösen kein onChanged aus.
 * In einer IIFE gekapselt, weil alle Experimente dieses Add-ons einen globalen Scope teilen.
 */
"use strict";
this.sharedBooks = (() => {

const { ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
const { VCardUtils, VCardProperties } = ChromeUtils.importESModule("resource:///modules/VCardUtils.sys.mjs");

const COLLECTED = "ldap_2.servers.history";
const MARK = "novabird.sharedBook";
const TOPICS = ["addrbook-contact-created", "addrbook-contact-updated", "addrbook-contact-deleted",
  "addrbook-directory-created", "addrbook-directory-updated", "addrbook-directory-deleted"];

const fires = new Set();
let applying = 0; // eigene Schreibvorgänge lösen kein onChanged aus

function dirOf(uid) {
  try {
    return MailServices.ab.getDirectoryFromUID(uid) || null;
  } catch {
    return null;
  }
}
function mirrorOf(dir) {
  try {
    return dir.getStringValue(MARK, "");
  } catch {
    return "";
  }
}
// Wohin Thunderbird Adressen sammelt (Standard: „Gesammelte Adressen“; einstellbar, z. B. das persönliche Adressbuch)
const collectTarget = () => Services.prefs.getCharPref("mail.collect_addressbook", "");
function kindOf(dir) {
  if (mirrorOf(dir)) return "mirror";
  if (dir.dirPrefId === COLLECTED || (collectTarget() && dir.URI === collectTarget())) return "collected";
  if (dir.isRemote || dir.dirType !== Ci.nsIAbManager.JS_DIRECTORY_TYPE) return "remote";
  return "local";
}
const syncable = dir => dir && ["local", "mirror"].includes(kindOf(dir));
const cardsOf = dir => dir.childCards.filter(c => !c.isMailList);
// UTF-8-Länge (TextEncoder gibt es im Experiment nicht)
function byteSize(s) {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

// vCard zum Teilen: Fotos nur als eingebettete Daten; ist die Karte zu groß, ohne Foto; ist sie dann noch zu groß: null
function shareVCard(card, maxBytes) {
  const props = card.vCardProperties.clone();
  for (const e of props.getAllEntries("photo")) {
    const v = String(e.value || "");
    if (!(v.startsWith("data:image/") || e.type === "binary")) props.removeEntry(e);
  }
  let text = props.toVCard();
  if (byteSize(text) > maxBytes) {
    for (const e of props.getAllEntries("photo")) props.removeEntry(e);
    text = props.toVCard();
  }
  return byteSize(text) > maxBytes ? null : text;
}

// Schreiben: ist das Adressbuch schreibgeschützt (Kopie, die man nicht ändern darf), den Schutz für die Dauer aufheben – alles
// läuft synchron, die Oberfläche kann nicht dazwischen schreiben
function writeBook(dir, work) {
  const locked = dir.readOnly;
  applying++;
  if (locked) dir.setBoolValue("readOnly", false);
  try {
    return work();
  } finally {
    if (locked) dir.setBoolValue("readOnly", true);
    applying--; // Benachrichtigungen kommen synchron, also schon vorbei
  }
}

const observer = {
  observe(subject, topic, data) {
    if (applying > 0 || !fires.size) return;
    let uid = "";
    try {
      if (topic.startsWith("addrbook-directory-")) {
        uid = subject?.QueryInterface?.(Ci.nsIAbDirectory)?.UID || "";
      } else {
        uid = String(data || "");
        const dir = uid && dirOf(uid);
        if (dir && !syncable(dir)) return; // Gesammelte, Online-Adressbücher: nie geteilt
      }
    } catch {
      /* trotzdem melden */
    }
    for (const fire of fires) fire.async(uid);
  },
};
let observing = false;
function observe(on) {
  if (on === observing) return;
  observing = on;
  for (const t of TOPICS) {
    if (on) Services.obs.addObserver(observer, t);
    else Services.obs.removeObserver(observer, t);
  }
}

const API = class extends ExtensionCommon.ExtensionAPI {
  onShutdown() {
    observe(false);
    fires.clear();
  }

  getAPI(context) {
    const { ExtensionError } = ChromeUtils.importESModule("resource://gre/modules/ExtensionUtils.sys.mjs");
    const book = uid => {
      const dir = dirOf(uid);
      if (!syncable(dir)) throw new ExtensionError("notlocal");
      return dir;
    };
    const mirror = uid => {
      const dir = dirOf(uid);
      if (!dir || !mirrorOf(dir)) throw new ExtensionError("nomirror");
      return dir;
    };
    return {
      sharedBooks: {
        async books() {
          return MailServices.ab.directories.map(d => ({ uid: d.UID, name: d.dirName, kind: kindOf(d), mirror: mirrorOf(d) || undefined, readOnly: !!d.readOnly }));
        },
        async cards(uid, maxBytes) {
          const dir = book(uid);
          const cards = [];
          const skipped = [];
          for (const c of cardsOf(dir)) {
            let vcard = null;
            try {
              vcard = shareVCard(c, maxBytes);
            } catch (e) {
              console.error("Geteilte Adressbücher: vCard", e);
            }
            if (vcard) cards.push({ uid: c.UID, vcard });
            else skipped.push(c.UID);
          }
          return { cards, skipped };
        },
        async createMirror(bookId, name, writable) {
          applying++;
          try {
            const prefId = MailServices.ab.newAddressBook(String(name).slice(0, 200), "", Ci.nsIAbManager.JS_DIRECTORY_TYPE);
            const dir = MailServices.ab.getDirectoryFromId(prefId);
            dir.setStringValue(MARK, String(bookId));
            dir.setBoolValue("readOnly", !writable);
            return dir.UID;
          } finally {
            applying--;
          }
        },
        async configureMirror(uid, name, writable) {
          const dir = mirror(uid);
          applying++;
          try {
            if (name && name !== dir.dirName) dir.dirName = String(name).slice(0, 200);
            if (!!dir.readOnly === !!writable) dir.setBoolValue("readOnly", !writable);
          } finally {
            applying--;
          }
        },
        // put [{uid, vcard}] anlegen oder an Ort und Stelle ersetzen, del [UID] löschen; liefert die vCards der geschriebenen
        // Kontakte so, wie Thunderbird sie jetzt hat (für den Vergleich beim nächsten Abgleich)
        async applyBook(uid, put, del, maxBytes) {
          const dir = book(uid);
          let errors = 0;
          const written = [];
          writeBook(dir, () => {
            const have = new Map(cardsOf(dir).map(c => [c.UID, c]));
            for (const it of put) {
              const id = String(it.uid);
              try {
                const old = have.get(id);
                let saved;
                if (old) {
                  const incoming = VCardProperties.fromVCard(String(it.vcard));
                  if (!incoming) throw new Error("vCard unlesbar");
                  const vp = old.vCardProperties;
                  const keepPhoto = incoming.getFirstEntry("photo") ? [] : vp.getAllEntries("photo");
                  for (const e of [...vp.entries]) vp.removeEntry(e);
                  for (const e of incoming.entries) vp.addEntry(e);
                  for (const e of keepPhoto) vp.addEntry(e);
                  saved = dir.modifyCard(old) || old;
                } else {
                  const card = VCardUtils.vCardToAbCard(String(it.vcard), id);
                  card.UID = id;
                  saved = dir.addCard(card) || card;
                }
                written.push({ uid: id, vcard: shareVCard(saved, maxBytes) || "" });
              } catch (e) {
                errors++;
                console.error("Geteilte Adressbücher: Kontakt übernehmen", e);
              }
            }
            const gone = del.map(u => have.get(String(u))).filter(Boolean);
            if (gone.length) dir.deleteCards(gone);
          });
          return { errors, cards: written };
        },
        async removeMirror(uid) {
          const dir = mirror(uid);
          applying++;
          try {
            MailServices.ab.deleteAddressBook(dir.URI);
          } finally {
            applying--;
          }
        },
        onChanged: new ExtensionCommon.EventManager({
          context,
          name: "sharedBooks.onChanged",
          register: fire => {
            fires.add(fire);
            observe(true);
            return () => {
              fires.delete(fire);
              if (!fires.size) observe(false);
            };
          },
        }).api(),
      },
    };
  }
};

return API;
})();
