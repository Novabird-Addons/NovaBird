// Gemeinsame Adapter-Schnittstelle. Alle Module sprechen nur hiermit.
//
//   execute(sql, params?)            -> Promise<number>   (geänderte Zeilen, falls bekannt)
//   select(sql, params?, columns)    -> Promise<object[]> (Objekte mit genau diesen Spalten)
//   batch([{sql, params}])           -> Promise<void>     (eine Transaktion)
//
// `columns` ist Pflicht bei select(): Die Experiment-API (mozStorage) kann
// Spaltennamen nicht zuverlässig aufzählen, daher liefert der Aufrufer sie mit.
// Parameter immer als Array (positionale ?-Platzhalter).

/** Adapter für Betterbird: spricht die Experiment-API messenger.novabirdDb an. */
export function createExperimentAdapter(api = globalThis.messenger?.novabirdDb) {
  if (!api) throw new Error("Experiment-API messenger.novabirdDb nicht verfügbar");
  return {
    kind: "experiment",
    open: (options) => api.open(options),
    execute: (sql, params = []) => api.execute(sql, params),
    select: (sql, params = [], columns) => {
      if (!Array.isArray(columns) || !columns.length) {
        throw new Error("select() braucht eine Spaltenliste");
      }
      return api.select(sql, params, columns);
    },
    batch: (statements) => api.executeBatch(statements),
    info: () => api.info(),
    close: () => api.close(),
    deleteIndex: () => api.deleteIndex(),
    moveAside: (keepOld) => api.moveAside(Boolean(keepOld)),
    deleteAside: () => api.deleteAside(),
    hasAside: () => api.hasAside(),
    idleSeconds: () => api.idleSeconds(),
  };
}
