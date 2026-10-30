"use strict";
/* Online-Updates: Abgleich Kanal-Datei ↔ installierte NovaBird-Add-ons und Installation in sinnvoller Reihenfolge.
 * Wird vom Hintergrundskript und von der Optionsseite geladen; die privilegierten Schritte macht das Experiment onlineUpdates. */
const nbUpdates = (() => {
  const ORDER = [
    "novabird-db@novabird", "novabird-conversation@novabird", "novabird-send@novabird",
    "novabird-extension@novabird", // zuletzt: die Extension aktualisiert sich selbst
  ];
  const SELF = "novabird-extension@novabird";
  // Ab NovaBird 2.0: NovaBird-Search enthält den Index und hat die ID des früheren NovaBird-DB; die Themes stecken in der Extension
  const NAMES = {
    "novabird-extension@novabird": "NovaBird-Extension", "novabird-db@novabird": "NovaBird-Search",
    "novabird-conversation@novabird": "NovaBird-Conversation", "novabird-send@novabird": "NovaBird-Send",
  };
  const DEFAULTS = { updatesEnabled: false, updatesChannel: "stable", updatesMode: "show", updatesOnStart: true, updatesManaged: {}, updatesLastCheck: 0 };

  // Versionen wie 1.10.1 numerisch vergleichen: <0, 0, >0
  function cmp(a, b) {
    const x = String(a || "0").split(".").map(Number);
    const y = String(b || "0").split(".").map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] || 0) - (y[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  // Verwaltet: Add-ons immer (außer abgewählt), Themes nur, wenn installiert (ein neues Theme würde sonst sofort aktiv)
  function managed(row, choice) {
    if (typeof choice?.[row.id] === "boolean") return choice[row.id];
    return row.type === "theme" ? Boolean(row.installed) : true;
  }

  async function check(channel, choice) {
    const api = messenger.onlineUpdates;
    const [ch, installed, app] = await Promise.all([api.fetchChannel(channel), api.getInstalled(), api.appVersion()]);
    const have = new Map(installed.map(a => [a.id, a]));
    const rows = ORDER.map(id => {
      const entry = ch.addons.find(a => a.id === id) || null;
      const inst = have.get(id) || null;
      const row = {
        id, name: NAMES[id], type: entry?.type || (id.startsWith("novabird-t-") ? "theme" : "extension"),
        installed: inst?.version || null, active: Boolean(inst?.active), available: entry?.version || null, entry,
      };
      if (!entry) row.status = "none";
      else if (entry.minApp && cmp(app, entry.minApp) < 0) row.status = "incompatible";
      else if (!inst) row.status = "missing";
      else {
        const d = cmp(entry.version, inst.version);
        row.status = d > 0 ? "update" : d < 0 ? "newer" : "current";
      }
      row.managed = managed(row, choice);
      return row;
    });
    return { channel: ch.channel, built: ch.built, commit: ch.commit, app, rows };
  }

  // Was „Alle aktualisieren“ tut: verwaltete Zeilen mit Update oder fehlend; älter (Kanalwechsel) nur auf ausdrücklichen Wunsch
  function pending(rows, { includeMissing = true, includeOlder = false } = {}) {
    return rows.filter(r => r.managed && r.entry && (r.status === "update" || (includeMissing && r.status === "missing") || (includeOlder && r.status === "newer")));
  }

  // Nacheinander installieren (Extension zuletzt); onStep(row, result) nach jedem Paket
  async function apply(rows, onStep) {
    const results = [];
    for (const row of [...rows].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id))) {
      if (row.id === SELF) {
        // die Extension wird beim eigenen Update beendet; vorher melden
        onStep?.(row, { ok: true, self: true });
        results.push({ row, result: { ok: true, self: true } });
        messenger.onlineUpdates.install(row.entry).catch(() => {});
        break;
      }
      let result;
      try {
        result = await messenger.onlineUpdates.install(row.entry);
      } catch (e) {
        result = { ok: false, error: String(e?.message || e) };
      }
      results.push({ row, result });
      onStep?.(row, result);
    }
    return results;
  }

  return { DEFAULTS, NAMES, ORDER, SELF, cmp, check, pending, apply };
})();
