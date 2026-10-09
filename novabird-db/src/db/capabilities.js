// Ermittelt, welche Volltext-Module das SQLite der Laufzeitumgebung kann.
// In Betterbird entspricht das den Spikes S1/S2. Das Ergebnis wird beim
// ersten Anlegen in meta gespeichert und danach wiederverwendet.

const PROBES = [
  ["fts5", "CREATE VIRTUAL TABLE temp.__cap_fts5 USING fts5(x)", "__cap_fts5"],
  [
    "contentlessDelete",
    "CREATE VIRTUAL TABLE temp.__cap_cd USING fts5(x, content='', contentless_delete=1)",
    "__cap_cd",
  ],
  ["trigram", "CREATE VIRTUAL TABLE temp.__cap_tri USING fts5(x, tokenize='trigram')", "__cap_tri"],
  ["fts4", "CREATE VIRTUAL TABLE temp.__cap_fts4 USING fts4(x)", "__cap_fts4"],
];

export async function detectCapabilities(db) {
  const caps = {};
  for (const [key, sql, table] of PROBES) {
    try {
      await db.execute(sql);
      caps[key] = true;
    } catch {
      caps[key] = false;
    }
    try {
      await db.execute(`DROP TABLE IF EXISTS temp.${table}`);
    } catch {
      /* ignorieren */
    }
  }
  const [{ v }] = await db.select("SELECT sqlite_version()", [], ["v"]);
  caps.sqliteVersion = v;
  caps.trigram = Boolean(caps.fts5 && caps.trigram);
  caps.ftsMode = caps.fts5
    ? caps.contentlessDelete
      ? "fts5-contentless"
      : "fts5"
    : caps.fts4
      ? "fts4"
      : "none";
  return caps;
}

/** Fähigkeiten für Tests bzw. Fallback-Prüfung gezielt einschränken. */
export function restrictCapabilities(caps, mode) {
  if (mode === "fts4") {
    return { ...caps, fts5: false, contentlessDelete: false, trigram: false, ftsMode: "fts4" };
  }
  if (mode === "fts5") {
    return { ...caps, contentlessDelete: false, ftsMode: "fts5" };
  }
  return caps;
}
