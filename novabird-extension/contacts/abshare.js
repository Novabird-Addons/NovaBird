"use strict";

/* Geteilte Adressbücher: Abgleich im Hintergrund über den gekoppelten NovaBird Helper (verschlüsselt mit dem Kopplungscode, ops
 * ab* in AddressBooks.cs des Helpers; Thunderbird-Seite im Experiment sharedBooks).
 *  - Anbieten: eigene lokale Adressbücher (nie „Gesammelte Adressen“, keine Online-Adressbücher) gehen an den Helper – für
 *    ausgewählte PCs oder alle PCs der Gruppe; write = die anderen dürfen ändern (auch löschen).
 *  - Abonnieren: angebotene Adressbücher anderer PCs landen als lokale Kopie („Name – PC“), schreibgeschützt, wenn die anderen
 *    nicht ändern dürfen. Nimmt der Besitzer die Freigabe zurück, verschwindet die Kopie; löscht der Nutzer die Kopie selbst, gilt
 *    sie als abbestellt.
 *  - Abgleich in beide Richtungen, für Original und Kopie gleich: Je Kontakt merkt sich Thunderbird den Stand des letzten
 *    Abgleichs (abBase: ETag im Helper und Prüfsumme der eigenen Fassung – Thunderbird schreibt vCards beim Speichern leicht um,
 *    deshalb zwei Werte). Daraus folgt, wer geändert hat: nur hier → hochladen (bedingt, mit dem zuletzt gesehenen ETag), nur
 *    im Helper → holen, beide → die Fassung im Helper gilt (Konflikt, gezählt). Ändern schlägt Löschen. Gelöscht wird nur mit
 *    gültigem Stand (gleiche Kennung, seq im Helper nicht kleiner als zuletzt – sonst nur zusammenführen); aus dem Helper nie
 *    mehr als die Hälfte eines Adressbuchs auf einmal (ab 20 Kontakten; dann bleiben die Löschungen liegen, mit Hinweis).
 *  - PC-Schlüssel (abPcKey): erzeugt Thunderbird selbst vor dem ersten Aufruf; der Helper merkt ihn sich beim ersten Mal und
 *    verlangt ihn danach. Jeder Abgleich meldet den PC an (auch ohne Freigaben), damit ihn kein anderer PC der Gruppe mit seiner
 *    Kennung zuerst beansprucht.
 *  - Bindung (abBind = Adresse des Helpers + Gruppe): Wechselt die Verbindung zu einem anderen Helper oder einer anderen Gruppe,
 *    gehen die Freigaben nicht ungefragt dorthin – Freigaben und Kopien werden zurückgesetzt. „Trennen“ zieht die eigenen
 *    Adressbücher im Helper zurück und entfernt die Kopien.
 *  - Wann: 45 s nach dem Start, dann alle 15 Minuten, 15 s nach einer Änderung in einem geteilten Adressbuch oder einer Kopie,
 *    sofort nach einer Änderung in den Einstellungen. Alles läuft durch eine Warteschlange.
 * Speicher (storage.local): abShare {Adressbuch-UID: {access, pcs, write}}, abSubs {Kennung im Helper: {dir, name}},
 * abBase:<Kennung> {seq, cards: {UID: [ETag, Prüfsumme]}}, abPcKey, abBind, abPublished, abStatus.
 */
const nbAbShare = (() => {
  const START_MS = 45_000, EVERY_MS = 15 * 60_000, CHANGE_MS = 15_000;
  const CHUNK_BYTES = 3 << 20; // Klartext je Anfrage (verschlüsselt und in Base64 knapp 4 MB; der Helper nimmt bis 8 MB)
  const ASK = 200; // Kontakte je abGet
  const MASS_MIN = 20, MASS_SHARE = 0.5; // Schutz vor Massenlöschung

  let queue = Promise.resolve();
  let changeTimer = null;

  const store = messenger.storage.local;
  const enc = new TextEncoder();
  async function etag(text) {
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
    return Array.from(d.slice(0, 8), b => b.toString(16).padStart(2, "0")).join("");
  }
  const errText = e => String(e?.message || e);
  const baseKey = id => "abBase:" + id;

  async function connection() {
    const { helperConn } = await store.get({ helperConn: null });
    return helperConn?.url && helperConn?.code ? helperConn : null;
  }

  // eigener Schlüssel, einmal erzeugt (32 Zufallsbytes, Base64url)
  async function pcKey() {
    let { abPcKey } = await store.get({ abPcKey: "" });
    if (!abPcKey) {
      abPcKey = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
      await store.set({ abPcKey });
    }
    return abPcKey;
  }

  async function call(conn, op, payload = {}) {
    // label: Name dieses PCs in der Liste des Helpers (so heißen auch die Kopien bei den anderen: „Adressbuch – PC“)
    return nbAI.helperCall(conn.url, conn.code, op, { ...payload, pcKey: await pcKey(), ...(conn.label ? { label: conn.label } : {}) });
  }

  async function dropBase(id) {
    if (id) await store.remove(baseKey(id));
  }

  // alle Kopien entfernen und nichts mehr teilen (Verbindung gewechselt oder getrennt)
  async function reset(s) {
    for (const [id, sub] of Object.entries(s.abSubs)) {
      if (sub.dir) await messenger.sharedBooks.removeMirror(sub.dir).catch(() => {});
      await dropBase(id);
    }
    for (const cfg of Object.values(s.abShare)) await dropBase(cfg.id);
    s.abShare = {};
    s.abSubs = {};
  }

  // nacheinander: Abgleich und Änderungen aus den Einstellungen
  function serial(work) {
    const run = queue.then(work, work);
    queue = run.catch(() => {});
    return run;
  }

  // ---- ein Adressbuch abgleichen (Original beim Besitzer oder Kopie) ---------------------------------------------------------
  // own: Original dieses PCs; canWrite: darf in den Helper schreiben. Liefert Zahlen für die Anzeige.
  async function syncBook(conn, id, dir, own, canWrite, limits) {
    const r = { count: 0, sent: 0, got: 0, deleted: 0, removed: 0, conflicts: 0, skipped: 0, held: 0, errors: 0 };
    const stored = (await store.get({ [baseKey(id)]: null }))[baseKey(id)];
    const state = await call(conn, "abState", { id });
    const remote = state.cards || {};
    const valid = !!stored && state.seq >= stored.seq; // sonst: Kopie im Helper neu oder älter (Sicherung) – nur zusammenführen
    const base = valid ? { ...stored.cards } : {};
    let seq = state.seq;
    const save = () => store.set({ [baseKey(id)]: { seq, cards: base } });

    const { cards, skipped } = await messenger.sharedBooks.cards(dir, limits.cardBytes);
    r.skipped = skipped.length;
    const skip = new Set(skipped);
    const local = new Map();
    for (const c of cards) if (!local.has(c.uid)) local.set(c.uid, { vcard: c.vcard, hash: await etag(c.vcard) });

    const put = [], del = [], pull = [], delLocal = [];
    for (const uid of new Set([...local.keys(), ...Object.keys(remote), ...Object.keys(base)])) {
      if (skip.has(uid)) continue; // zu groß zum Teilen: weder hoch noch löschen
      const L = local.get(uid), R = remote[uid], B = base[uid];
      if (L && R && L.hash === R) {
        base[uid] = [R, L.hash]; // gleich (auch ohne gemerkten Stand)
        continue;
      }
      if (!B) {
        if (L && R) {
          if (own && canWrite) put.push({ uid, vcard: L.vcard, base: R }); // Original ohne Stand: die eigene Fassung gilt
          else pull.push(uid);
        } else if (L) {
          if (canWrite) put.push({ uid, vcard: L.vcard, base: "" });
          else if (valid) delLocal.push(uid); // gibt es im Helper nicht (Kopie ohne Schreibrecht)
        } else if (R) {
          pull.push(uid);
        }
        continue;
      }
      const lChanged = L && L.hash !== B[1];
      const rChanged = R && R !== B[0];
      if (L && R) {
        if (lChanged && rChanged) {
          r.conflicts++;
          pull.push(uid); // beide geändert: die Fassung im Helper gilt
        } else if (lChanged) {
          if (canWrite) put.push({ uid, vcard: L.vcard, base: R });
          else pull.push(uid); // ohne Schreibrecht: eigene Änderung wird zurückgeholt
        } else if (rChanged) {
          pull.push(uid);
        }
      } else if (L) { // im Helper gelöscht
        if (lChanged && canWrite) put.push({ uid, vcard: L.vcard, base: "" }); // hier geändert: Ändern schlägt Löschen
        else delLocal.push(uid);
      } else if (R) { // hier gelöscht
        if (rChanged || !canWrite) pull.push(uid); // dort geändert oder ohne Schreibrecht: wiederherstellen
        else del.push({ uid, base: R });
      } else {
        delete base[uid]; // beidseitig gelöscht
      }
    }

    // Schutz vor Massenlöschung von außen (z. B. Kopie im Helper versehentlich geleert): Löschungen, die hier jemand selbst
    // gemacht hat, gehen weiter hinaus
    if (delLocal.length >= MASS_MIN && delLocal.length > local.size * MASS_SHARE) {
      r.held += delLocal.length;
      delLocal.length = 0;
    }

    // hochladen: Löschungen, dann Änderungen in Paketen; abgelehnte (inzwischen anderswo geändert) werden geholt
    const rejected = new Set();
    const send = async payload => {
      const res = await call(conn, "abPut", { id, ...payload });
      seq = Math.max(seq, res.seq || 0);
      for (const u of res.conflicts || []) rejected.add(u);
      return res;
    };
    for (let i = 0; i < del.length; i += limits.batch) {
      const part = del.slice(i, i + limits.batch);
      await send({ del: part });
      for (const d of part) if (!rejected.has(d.uid)) {
        delete base[d.uid];
        r.deleted++;
      }
      await save();
    }
    let batch = [], bytes = 0;
    const flush = async () => {
      if (!batch.length) return;
      await send({ put: batch });
      for (const c of batch) if (!rejected.has(c.uid)) {
        base[c.uid] = [await etag(c.vcard), local.get(c.uid).hash];
        r.sent++;
      }
      batch = [];
      bytes = 0;
      await save();
    };
    for (const c of put) {
      const size = enc.encode(c.vcard).length + c.uid.length + 48;
      if (batch.length && (batch.length >= limits.batch || bytes + size > CHUNK_BYTES)) await flush();
      batch.push(c);
      bytes += size;
    }
    await flush();
    if (rejected.size) {
      r.conflicts += rejected.size;
      const now = await call(conn, "abState", { id });
      seq = Math.max(seq, now.seq);
      for (const u of rejected) {
        remote[u] = now.cards?.[u];
        if (remote[u]) pull.push(u);
      }
    }

    // holen: in Paketen; der Helper liefert in der Reihenfolge der Anfrage, bei viel Inhalt nur den Anfang
    let need = [...new Set(pull)].filter(u => remote[u]);
    while (need.length) {
      const ask = need.slice(0, ASK);
      const res = await call(conn, "abGet", { id, uids: ask });
      const got = res.cards || [];
      if (!got.length) {
        need = need.slice(ask.length); // inzwischen gelöscht
        continue;
      }
      seq = Math.max(seq, res.seq || 0);
      const w = await messenger.sharedBooks.applyBook(dir, got.map(c => ({ uid: c.uid, vcard: c.vcard })), [], limits.cardBytes);
      r.errors += w.errors;
      const etags = new Map(got.map(c => [c.uid, c.etag]));
      for (const c of w.cards) {
        base[c.uid] = [etags.get(c.uid), c.vcard ? await etag(c.vcard) : ""];
        r.got++;
      }
      await save();
      need = need.slice(ask.indexOf(got[got.length - 1].uid) + 1);
    }
    if (delLocal.length) {
      await messenger.sharedBooks.applyBook(dir, [], delLocal, limits.cardBytes);
      for (const u of delLocal) delete base[u];
      r.removed = delLocal.length;
    }
    await save();
    r.count = Object.keys(base).length;
    return r;
  }

  const mirrorName = o => `${o.name} – ${o.owner}`;

  // ---- ein Abgleich ---------------------------------------------------------------------------------------------------------
  async function syncOnce() {
    const s = await store.get({ abShare: {}, abSubs: {}, abPublished: false, abBind: "" });
    const status = { at: Date.now(), error: "", own: {}, subs: {}, removed: [] };
    const conn = await connection();
    if (!conn) {
      await store.set({ abStatus: { ...status, idle: true } });
      return status;
    }
    let info;
    try {
      info = await call(conn, "abInfo"); // meldet diesen PC mit seinem Schlüssel an, auch ohne Freigaben
    } catch (e) {
      status.error = errText(e);
      await store.set({ abStatus: status });
      return status;
    }
    const bind = `${conn.url}|${info.group || ""}`;
    if (s.abBind && s.abBind !== bind) {
      // anderer Helper oder andere Gruppe: Freigaben nicht dorthin mitnehmen, Kopien des alten Helpers entfernen
      if (Object.keys(s.abShare).length || Object.keys(s.abSubs).length) status.reset = true;
      await reset(s);
      s.abPublished = false;
    }
    await store.set({ abBind: bind });
    if (!Object.keys(s.abShare).length && !Object.keys(s.abSubs).length && !s.abPublished) {
      await store.set({ abShare: s.abShare, abSubs: s.abSubs, abStatus: { ...status, idle: !status.reset } });
      return status;
    }
    const limits = { cardBytes: 240 << 10, batch: 500, ...(info.limits || {}) };
    limits.batch = Math.min(500, limits.batch);
    const books = await messenger.sharedBooks.books();
    const local = new Map(books.filter(b => b.kind === "local").map(b => [b.uid, b]));

    // eigene: anbieten bzw. Freigabe und Name nachführen, in beide Richtungen abgleichen
    for (const [tb, cfg] of Object.entries(s.abShare)) {
      const b = local.get(tb);
      if (!b) {
        await dropBase(cfg.id);
        delete s.abShare[tb]; // Adressbuch gelöscht (oder kein eigenes lokales mehr): nicht mehr teilen
        continue;
      }
      try {
        const pub = await call(conn, "abPublish", { tb, name: b.name, access: cfg.access === "pcs" ? "pcs" : "group", pcs: cfg.pcs || [], write: cfg.write !== false });
        if (cfg.id && cfg.id !== pub.id) await dropBase(cfg.id); // neue Kennung (im Helper gelöscht): Stand gilt nicht mehr
        cfg.id = pub.id;
        status.own[tb] = { id: pub.id, ...(await syncBook(conn, pub.id, tb, true, true, limits)) };
      } catch (e) {
        status.own[tb] = { error: errText(e) };
      }
    }
    let left = 0;
    for (const o of info.own || []) {
      if (Object.values(s.abShare).some(c => c.id === o.id) || s.abShare[o.tb]) continue;
      await call(conn, "abUnpublish", { id: o.id }).catch(e => {
        left++;
        console.error("NovaBird: Adressbuch zurückziehen", e);
      });
    }

    // abonnierte: Kopie anlegen, abgleichen oder entfernen
    const offered = new Map((info.offered || []).map(o => [o.id, o]));
    const have = new Set(books.map(b => b.uid));
    for (const [id, sub] of Object.entries(s.abSubs)) {
      const o = offered.get(id);
      try {
        if (!o) {
          if (sub.dir && have.has(sub.dir)) await messenger.sharedBooks.removeMirror(sub.dir);
          status.removed.push(sub.name || id);
          await dropBase(id);
          delete s.abSubs[id];
          continue;
        }
        if (sub.dir && !have.has(sub.dir)) {
          await dropBase(id);
          delete s.abSubs[id]; // Kopie selbst gelöscht: abbestellt
          continue;
        }
        const name = mirrorName(o);
        if (!sub.dir) {
          sub.dir = await messenger.sharedBooks.createMirror(id, name, !!o.write);
          await dropBase(id);
        } else {
          await messenger.sharedBooks.configureMirror(sub.dir, name, !!o.write);
        }
        sub.name = name;
        status.subs[id] = { write: !!o.write, ...(await syncBook(conn, id, sub.dir, false, !!o.write, limits)) };
      } catch (e) {
        status.subs[id] = { error: errText(e) };
      }
    }
    // abPublished: im Helper liegt (vielleicht) noch etwas von hier – dann auch ohne Freigaben einmal abgleichen und zurückziehen
    await store.set({ abShare: s.abShare, abSubs: s.abSubs, abStatus: status, abPublished: Object.keys(s.abShare).length > 0 || left > 0 });
    return status;
  }

  const sync = () => serial(() => syncOnce().catch(e => {
    console.error("NovaBird: geteilte Adressbücher", e);
    return { error: errText(e) };
  }));

  // ---- Einstellungsseite ----------------------------------------------------------------------------------------------------
  // Übersicht: eigene Adressbücher (welche teilbar), andere PCs der Gruppe, Angebote für diesen PC, Abos, letzter Abgleich
  async function overview() {
    const conn = await connection();
    const s = await store.get({ abShare: {}, abSubs: {}, abStatus: null });
    const books = await messenger.sharedBooks.books();
    const res = { connected: !!conn, books: books.filter(b => b.kind === "local" || b.kind === "collected"), share: s.abShare, subs: s.abSubs, status: s.abStatus, pcs: [], offered: [], error: "" };
    if (!conn) return res;
    try {
      const info = await call(conn, "abInfo");
      res.pcs = info.pcs || [];
      res.offered = info.offered || [];
    } catch (e) {
      res.error = errText(e);
    }
    return res;
  }

  // share: {UID: {access, pcs, write} | null}, sub: {Kennung: true | false}
  function change({ share = {}, sub = {} }) {
    return serial(async () => {
      const s = await store.get({ abShare: {}, abSubs: {} });
      const books = await messenger.sharedBooks.books();
      for (const [tb, cfg] of Object.entries(share)) {
        if (!cfg) {
          await dropBase(s.abShare[tb]?.id);
          delete s.abShare[tb];
        } else if (books.some(b => b.uid === tb && b.kind === "local")) {
          s.abShare[tb] = { id: s.abShare[tb]?.id, access: cfg.access === "pcs" ? "pcs" : "group", pcs: (cfg.pcs || []).map(String), write: cfg.write !== false };
        }
      }
      const conn = await connection();
      for (const [id, on] of Object.entries(sub)) {
        if (on) {
          s.abSubs[id] ??= {};
        } else if (s.abSubs[id]) {
          const dir = s.abSubs[id].dir;
          // vorher eigene Änderungen in der Kopie noch hochladen (so gut es geht)
          if (dir && conn) {
            try {
              const info = await call(conn, "abInfo");
              const o = (info.offered || []).find(x => x.id === id);
              if (o?.write) await syncBook(conn, id, dir, false, true, { cardBytes: 240 << 10, batch: 500, ...(info.limits || {}) });
            } catch (e) {
              console.error("NovaBird: Kopie vor dem Abbestellen abgleichen", e);
            }
          }
          if (dir) await messenger.sharedBooks.removeMirror(dir).catch(() => {});
          await dropBase(id);
          delete s.abSubs[id];
        }
      }
      await store.set({ abShare: s.abShare, abSubs: s.abSubs, abPublished: true }); // nach dem Abwählen einmal zurückziehen
      return syncOnce();
    });
  }

  // „Trennen“: eigene Adressbücher im Helper zurückziehen (so gut es geht), Kopien entfernen, nichts mehr teilen
  function disconnect() {
    return serial(async () => {
      const s = await store.get({ abShare: {}, abSubs: {} });
      const conn = await connection();
      if (conn) {
        try {
          const info = await call(conn, "abInfo");
          for (const o of info.own || []) await call(conn, "abUnpublish", { id: o.id }).catch(() => {});
        } catch (e) {
          console.error("NovaBird: Adressbücher beim Trennen zurückziehen", e);
        }
      }
      await reset(s);
      await store.set({ abShare: {}, abSubs: {}, abPublished: false, abBind: "", abStatus: null });
    });
  }

  // nur Seiten dieser Erweiterung (Einstellungen), keine Inhaltsskripte
  const own = sender => String(sender?.url || "").startsWith(messenger.runtime.getURL(""));
  messenger.runtime.onMessage.addListener((message, sender) => {
    if (!String(message?.type || "").startsWith("abshare:") || !own(sender)) return undefined;
    if (message.type === "abshare:overview") return overview();
    if (message.type === "abshare:change") return change(message);
    if (message.type === "abshare:sync") return sync();
    if (message.type === "abshare:disconnect") return disconnect();
    return undefined;
  });

  // ---- Zeitplan ---------------------------------------------------------------------------------------------------------------
  messenger.sharedBooks.onChanged.addListener(async uid => {
    const { abShare, abSubs } = await store.get({ abShare: {}, abSubs: {} });
    const dirs = new Set([...Object.keys(abShare), ...Object.values(abSubs).map(x => x.dir).filter(Boolean)]);
    if (!dirs.size || (uid && !dirs.has(uid))) return;
    clearTimeout(changeTimer);
    changeTimer = setTimeout(sync, CHANGE_MS);
  });
  messenger.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.helperConn) {
      clearTimeout(changeTimer);
      changeTimer = setTimeout(sync, 2000);
    }
  });
  setTimeout(sync, START_MS);
  setInterval(sync, EVERY_MS);

  return { sync, overview, change };
})();
