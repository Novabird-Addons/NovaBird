# Changelog

Releases are tagged `vX.Y.Z` on `main`; work in progress lives on the branch `testing`.

## Unreleased (testing)

### NovaBird-DB 1.2.5
- Faster search in large mailboxes. Finding compound words ("plan" also finds "Speiseplan") looked up every new search term in a view of the whole full-text index, which took over a second per term in large real mailboxes. The words are now kept in a small table of their own (only words that occur in at least two mails, exactly the ones used before), refreshed after indexing and when idle. While typing, the words found for "galax" are reused for "galaxu" instead of being searched again. Same results as before; a lab test with 1.78 million index words: 148 ms → 1 ms per term.

## 1.2.0 (2026-10-13)
Conversation 0.14.10 · Extension 1.9.15 · unchanged: Search 1.2.6 · DB 1.2.4 · Send 1.0.4 · Sand 1.0.1 · Cobalt 1.0.3 · Springlight 1.7.3

### Docs
- Install several add-ons at once: select all `.xpi` files in the file dialog (Ctrl+A) or drag them onto the add-ons manager.

### NovaBird-Conversation 0.14.8 to 0.14.10
- Mails that draw their logo or text as pixel graphics from thousands of tiny table cells (common in spam, sometimes in newsletters) were shown as a long empty area, with the text pushed far to the side. Line breaks and spaces inside `font-size:0` are now dropped like in the original, and tables left without text or images are left out.
- The button "Original" in each message header is now called "Original view" (0.14.9).
- A single message is always shown in full; the height limit with "Show all" only applies when more messages follow below (0.14.10).

### NovaBird-Extension 1.9.15
- New, opt-in: **Rule assistant (beta)** – off by default, switch it on under Settings → NovaBird → Extension → "Rules (beta)". The message list context menu then offers "Create rule from this mail …": a guided page with ready-made conditions taken from the mail (this sender, this domain, subject, recipient, or a custom one), a live preview of the matching mails in the inbox, actions (move, tag, mark read, star, trash), accounts and timing, and a plain-language summary. It saves a normal Betterbird message filter that keeps working without NovaBird; existing filters are never changed and the filter file is backed up first.
- The "New Message" button above the folder list was cut off ("New Mess…") already at the default width. Slightly tighter spacing in that header; if the text still does not fit, the "+" icon is dropped before the text gets shortened.

## 1.1.0 (2026-10-12)
Search 1.2.6 · DB 1.2.4 · Conversation 0.14.7 · Send 1.0.4 · Extension 1.9.14 · Sand 1.0.1 · Cobalt 1.0.3 · Springlight 1.7.3

### All add-ons: self-test after Betterbird updates, shared code
- Search 1.2.6, Conversation 0.14.6, Send 1.0.4, Extension 1.9.14: each add-on checks at start and whenever its settings page is opened whether the Betterbird internals it relies on are still there. If something is missing after a Betterbird update, only the affected feature stays off and the add-on's settings page shows "Not all features available" with the list. Nothing is shown while everything is fine.
- Shared code in `shared/` (packed into each add-on): reading the theme colours (Conversation, Send), colour maths (Send, Extension settings page), self-test, and one check for the language files in the tests.

### NovaBird-DB 1.2.1 to 1.2.4
- 1.2.4: indexing reads each message once (text and attachment list from one call) instead of twice; about 10 % faster in the lab (20,000 mails: 25 s instead of 27–28 s) and about a third faster on a real profile (4:00 instead of 6+ minutes); the index content is identical.
- 1.2.3: the default search languages are now English plus the language of Betterbird (if supported), so mixed English/own-language mailboxes work out of the box. A saved language choice is not changed.
- 1.2.2: indexing no longer hangs on a single broken message or folder. A message that is not read within 5 s is stored with headers only, three in a row make the indexer give up that folder and continue with the next one (it is retried on the next run), and loading a folder list is limited to 60 s. A watchdog writes "No progress for N s" with the folder and step to the log, together with the hint to repair the folder first. New option "Detailed index log" (off by default).
- Folders without offline storage (IMAP "always online", e.g. Gmail) are indexed with headers only and are done after one pass. They are no longer read again on every start, and neither the folder reconcile nor the weekly deep check re-reads them when the message count changes (new mail arrives through events and the date-based catch-up). Fixes [#1](https://github.com/Novabird-Addons/NovaBird/issues/1).
- If the offline-storage setting of a folder changes, the folder is read once more so the message texts reach the index.
- Virtual folders (saved searches, unified folders such as "All inboxes") are no longer indexed; their mails are already indexed in their real folders.
- Messages in an online-only folder that are downloaded individually still get their text.
- Mails filed into an online-only folder with an old date (server rules, moves on another device) are only picked up by "Rebuild index" / a full run.

### Themes: Sand 1.0.1, Cobalt 1.0.3, Springlight 1.7.3
- Windows: no more wide border/shadow around menus and context menus (the shadow did not fit into the space Windows reserves for it and was cut off). Menus keep their 1 px frame and rounded corners. Background: `docs/windows-menue-rand.md`.

### NovaBird-Send 1.0.3
- Fix: if showing the compose window again failed after a send error (or on undo), the queue stopped and Betterbird could not quit (it waited for the send forever). The queue now always continues and quitting is never blocked; if the undo bar cannot be shown, the compose window comes back instead of staying hidden.
- The compose window is hidden before the mail is queued, so a failure there lets Betterbird send normally without a second attempt later.
- Mail subjects are no longer written to the error console.

### NovaBird-Extension 1.9.8
- Option "Wider scrollbars" (message list and folder pane), on by default.

### NovaBird-Extension 1.9.9
- Fix: in the NovaBird settings page the embedded add-on pages stayed light with dark themes (Sand dark, Cobalt, Springlight). The dark/light detection could not read the colour format that newer Betterbird versions return.

### NovaBird-Extension 1.9.10 to 1.9.13
- 1.9.13: Nova-Contact: the file with locally stored tags is written safely (temporary file, previous version kept as backup). If it cannot be read, it is set aside and the backup is loaded instead of starting empty and overwriting it.
- Nova-Contact: an active tag filter is shown as a chip next to the Tags button (with ✕ to clear) instead of as text in the search field. The chip can be combined with search text (e.g. a name within a tag), also for tags stored only on this computer.
- Nova-Contact: the contact detail view now says "Tags" instead of "Categories" and also shows tags that are stored only on this computer (Google/CardDAV address books), with a small note that they are not synchronised.

### NovaBird-Conversation 0.14.7
- No more flash of Betterbird's own message view before the conversation (confirmed on a slow and a fast PC): the reading pane is hidden while a different message loads and shown as soon as the conversation (or the normal view) is ready, at the latest after 1.5 s. Selecting the same message again is not affected. Lab: conversation visible after 35–110 ms, normal view of a single message after about 40 ms.
- If "Thunderbird Conversations" is also active, the settings page says so once (opened automatically) and offers to disable it; nothing is switched off without a click.

### NovaBird-Conversation 0.14.2 to 0.14.5
- 0.14.5: closed tabs and windows are released from memory (the thread hook kept them until restart).
- Fix: selecting a collapsed thread in the message list showed Betterbird's own thread summary instead of the conversation view. Now the message of the selected row is shown, so the conversation view works without expanding the thread first. Real multi-selection is unchanged.
- 0.14.3: hovering the sender name shows the email address; right-click on the name offers "Copy email address".
- 0.14.4: less flicker when switching messages on slow computers. The conversation lookup now starts as soon as the message is displayed (before the view script runs), and the original text stays hidden for up to 1.5 s (was 0.45 s) so Betterbird's own message view no longer flashes up before the conversation.
