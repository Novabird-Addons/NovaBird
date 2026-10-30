// Test-Adapter mit better-sqlite3. Bildet die Semantik der Experiment-API nach
// (Spaltenliste Pflicht, Batch = eine Transaktion, Parameter als Array).
import Database from "better-sqlite3";

export function createNodeAdapter(path = ":memory:") {
  const db = new Database(path);
  const run = (sql, params = []) => db.prepare(sql).run(...params).changes;
  return {
    kind: "node",
    raw: db,
    async execute(sql, params = []) {
      return run(sql, params);
    },
    async select(sql, params = [], columns) {
      if (!Array.isArray(columns) || !columns.length) {
        throw new Error("select() braucht eine Spaltenliste");
      }
      const rows = db.prepare(sql).raw(true).all(...params);
      return rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
    },
    async batch(statements) {
      db.transaction(() => {
        for (const { sql, params } of statements) run(sql, params ?? []);
      })();
    },
    async close() {
      db.close();
    },
  };
}
