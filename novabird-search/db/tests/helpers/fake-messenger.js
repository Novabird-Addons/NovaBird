// Minimaler Nachbau der benötigten messenger.*-API für Indexer-Tests.
// Bildet Seitenweise-Listen (list/continueList) und Events nach.

function fakeEvent() {
  const listeners = new Set();
  return {
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    hasListener: (fn) => listeners.has(fn),
    fire: async (...args) => {
      for (const fn of listeners) await fn(...args);
    },
    get count() {
      return listeners.size;
    },
  };
}

export function createFakeMessenger({ pageSize = 2 } = {}) {
  const folders = {
    inbox: { id: "account1://INBOX", accountId: "account1", path: "/INBOX", name: "Posteingang", specialUse: ["inbox"], subFolders: [] },
    sent: { id: "account1://Sent", accountId: "account1", path: "/Sent", name: "Gesendet", specialUse: ["sent"], subFolders: [] },
    trash: { id: "account1://Trash", accountId: "account1", path: "/Trash", name: "Papierkorb", specialUse: ["trash"], subFolders: [] },
    projekt: { id: "account1://INBOX/Projekt", accountId: "account1", path: "/INBOX/Projekt", name: "Projekt", specialUse: [], subFolders: [] },
  };
  folders.inbox.subFolders.push(folders.projekt);

  let nextId = 1;
  const store = new Map(); // folderId -> [header]
  const bodies = new Map(); // session id -> text
  for (const f of Object.values(folders)) store.set(f.id, []);

  const pages = new Map();
  let pageCounter = 0;
  const makeList = (headers) => {
    const chunks = [];
    for (let i = 0; i < headers.length; i += pageSize) chunks.push(headers.slice(i, i + pageSize));
    if (!chunks.length) chunks.push([]);
    const ids = chunks.map(() => `page-${++pageCounter}`);
    chunks.forEach((c, i) => pages.set(ids[i], { id: i + 1 < chunks.length ? ids[i + 1] : null, messages: c }));
    return { id: chunks.length > 1 ? ids[1] : null, messages: chunks[0] };
  };

  const calls = { listInlineTextParts: 0 };

  const api = {
    accounts: {
      list: async () => [{ id: "account1", rootFolder: { subFolders: [folders.inbox, folders.sent, folders.trash] } }],
    },
    folders: { getFolderInfo: async (id) => ({ totalMessageCount: store.get(id)?.length ?? 0 }), onDeleted: fakeEvent(), onRenamed: fakeEvent(), onMoved: fakeEvent() },
    messages: {
      list: async (folderId) => makeList([...store.get(folderId)]),
      continueList: async (id) => pages.get(id),
      query: async ({ accountId, fromDate }) =>
        makeList(
          Object.values(folders)
            .filter((f) => f.accountId === accountId)
            .flatMap((f) => store.get(f.id))
            .filter((h) => !fromDate || +h.date >= +fromDate),
        ),
      listInlineTextParts: async (id) => {
        calls.listInlineTextParts++;
        return [{ contentType: "text/plain", content: bodies.get(id) ?? "" }];
      },
      listAttachments: async () => [],
      tags: { list: async () => [{ key: "$label1", tag: "Wichtig" }] },
      onNewMailReceived: fakeEvent(),
      onDeleted: fakeEvent(),
      onMoved: fakeEvent(),
      onCopied: fakeEvent(),
      onUpdated: fakeEvent(),
    },
  };

  /** Testhilfe: Nachricht in einen Ordner legen. */
  function addMessage(folderKey, { subject, body = "", author = "Jonas Müller <jonas@x.de>", date = new Date(2026, 8, 1), headerMessageId }) {
    const folder = folders[folderKey];
    const h = {
      id: nextId++,
      headerMessageId: headerMessageId ?? `msg${nextId}@x`,
      subject,
      author,
      recipients: ["Firma <p@x.de>"],
      ccList: [],
      date,
      read: false,
      flagged: false,
      tags: [],
      folder,
    };
    store.get(folder.id).push(h);
    bodies.set(h.id, body);
    return h;
  }

  function removeMessage(folderKey, header) {
    const list = store.get(folders[folderKey].id);
    list.splice(list.indexOf(header), 1);
  }

  return { api, folders, addMessage, removeMessage, makeList, calls };
}
