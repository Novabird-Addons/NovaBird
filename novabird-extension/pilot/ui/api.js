"use strict";
/* Kapselt die Thunderbird-Schnittstellen. Die NovaBird-Extension nutzt Manifest V2: Kontakte über messenger.contacts
   (vCard in properties.vCard). Die V3-Form (addressBooks.contacts) bleibt als Weiche erhalten. */
(function () {
  const api = globalThis.messenger || globalThis.browser;
  const v3 = !!api.addressBooks?.contacts;
  const vCardOf = node => node.vCard ?? node.properties?.vCard ?? "";
  globalThis.CP_API = {
    contacts: v3 ? {
      list: bookId => api.addressBooks.contacts.list(bookId),
      create: (bookId, vCard) => api.addressBooks.contacts.create(bookId, vCard),
      update: (id, vCard) => api.addressBooks.contacts.update(id, vCard),
      delete: id => api.addressBooks.contacts.delete(id),
      vCardOf,
    } : {
      list: bookId => api.contacts.list(bookId),
      create: (bookId, vCard) => api.contacts.create(bookId, null, { vCard }),
      update: (id, vCard) => api.contacts.update(id, { vCard }),
      delete: id => api.contacts.delete(id),
      vCardOf,
    },
    /* Ordnerbaum eines Kontos (MV2: acc.folders, MV3: rootFolder.subFolders) */
    async foldersOf(acc) {
      if (acc.rootFolder?.subFolders) return acc.rootFolder.subFolders;
      if (acc.folders) return acc.folders;
      const root = acc.rootFolder?.id;
      if (!root) return [];
      try { return await api.folders.getSubFolders(root, true); } catch { return []; }
    }
  };
})();
