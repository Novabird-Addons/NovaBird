# Changelog

Entries on `testing` are not released yet; releases are tagged `vX.Y.Z` on `main`.

## Unreleased (`testing`)

### NovaBird-DB 1.2.1
- Folders without offline storage (IMAP "always online", e.g. Gmail) are indexed with headers only and are done after one pass. They are no longer read again on every start, and neither the folder reconcile nor the weekly deep check re-reads them when the message count changes (new mail arrives through events and the date-based catch-up). Fixes [#1](https://github.com/Novabird-Addons/NovaBird/issues/1).
- If the offline-storage setting of a folder changes, the folder is read once more so the message texts reach the index.
- Virtual folders (saved searches, unified folders such as "All inboxes") are no longer indexed; their mails are already indexed in their real folders.
- Messages in an online-only folder that are downloaded individually still get their text.
- Mails filed into an online-only folder with an old date (server rules, moves on another device) are only picked up by "Rebuild index" / a full run.

### NovaBird-Extension 1.9.8
- Option "Wider scrollbars" (message list and folder pane), on by default.

### NovaBird-Extension 1.9.9
- Fix: in the NovaBird settings page the embedded add-on pages stayed light with dark themes (Sand dark, Cobalt, Springlight). The dark/light detection could not read the colour format that newer Betterbird versions return.

### NovaBird-Extension 1.9.10 / 1.9.11
- Nova-Contact: an active tag filter is shown as a chip next to the Tags button (with ✕ to clear) instead of as text in the search field. Typing in the search field replaces the tag filter.
- Nova-Contact: the contact detail view now says "Tags" instead of "Categories" and also shows tags that are stored only on this computer (Google/CardDAV address books), with a small note that they are not synchronised.

### NovaBird-Conversation 0.14.2
- Fix: selecting a collapsed thread in the message list showed Betterbird's own thread summary instead of the conversation view. Now the message of the selected row is shown, so the conversation view works without expanding the thread first. Real multi-selection is unchanged.
