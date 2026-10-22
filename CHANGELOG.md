# Changelog

Releases are tagged `vX.Y.Z` on `main`; work in progress lives on the branch `testing`.

## Unreleased (branch `testing`)
Search 1.2.9 · Conversation 0.15.3 · unchanged: Extension 1.10.1 · DB 1.2.5 · Send 1.0.4 · Sand 1.0.1 · Cobalt 1.0.3 · Springlight 1.7.3

### NovaBird-Search 1.2.9
- **Thunderbird 158 (release channel):** after clearing the search with "✕" the message list stayed empty instead of showing the folder again, and changing the search word could leave the old results. Cause: since Thunderbird 158, `gDBView` in the mail tab is only a getter (taken from `gViewWrapper`); setting it to `null` throws there, so returning from the results view stopped before the folder was reopened. The value is now only set where it is still a variable (Thunderbird 153 ESR and older). Tested with 153.5 ESR and 158.0, table and card view.

### NovaBird-Conversation 0.15.3
- **Low screens:** the pinned newest message took as much height as its header, buttons and text needed, and the history below kept only 5rem, so little of it was readable. The setting "maximum height of the pinned message" (default 60 %) now limits the whole message card, not only its text; below 700 px view height it is at most 55 %. The text is shortened so that header, attachments, buttons and "Show full" fit into that height, and it fades out at the bottom when shortened. Measured with a 452 px reading pane: history 140 px instead of 97 px.

## 1.3.0 (2026-10-17)
Search 1.2.8 · Extension 1.10.1 · Conversation 0.15.2 · unchanged: DB 1.2.5 · Send 1.0.4 · Sand 1.0.1 · Cobalt 1.0.3 · Springlight 1.7.3

### NovaBird-Search 1.2.8
- Analysis page: all font sizes are now in `rem` (default font of the page, so they follow the font settings). Measured on Windows (1 rem = 17 px): same size as before there; on Linux, where the default font is usually 16 px, up to 6 % smaller.

### NovaBird-Search 1.2.7
- The title block in the list header (folder name and count) had a fixed minimum width of 200 px. With the smaller system font on Windows this left a wide gap before the search field. It is now `10.5em` and scales with the font.
- The search bar followed the system menu font size instead of the font size set in Thunderbird, so it did not change with the setting. The font family is still the system one, the size is now inherited.
- Windows only (`@media (-moz-platform: windows)`): search field and the time-range chips are slightly larger so they match the rest of the window.

### NovaBird-Conversation 0.15.2
- Font sizes of the conversation view are now in `rem` (root font of the reading pane, follows Thunderbird's font setting and the zoom). Measured on Windows: exactly the same sizes as before (1 rem = 17 px).

### NovaBird-Conversation 0.15.1
- New, only if the AI summary is set up in NovaBird-Extension: a button "Summarise (AI)" in the header of the conversation view. It opens a window with a summary of the whole conversation (oldest message first).

### NovaBird-Extension 1.10.1
- **Settings page reorganised:** tabs ordered from look to features to information – Message list, Colors and fonts, Right pane and attachments, Nova-Contact, Rules (beta), AI, Mailbox. The attachment preview (formerly a tab of its own with one switch) is now part of "Right pane and attachments"; the diagnostics block moved from below every tab into the Mailbox tab. The tab row wraps on narrow windows, and the page reopens in the tab used last.
- AI tab: the instruction to the model and its explanation are folded in ("Instruction to the AI", click to open). The button "Settings" in the summary window opens the AI tab directly.

### NovaBird-Extension 1.10.0
- **New settings tab "Colors and fonts"** (formerly "Colors"), two columns side by side, with a small sketch of the main window: moving the mouse over a color outlines the area it affects.
- **Custom Colors:** all colors the NovaBird themes set in the main window can be changed, each with a short description of what it affects: spaces bar, toolbar, folder pane, message list and view, text, secondary text, folder text, borders, row separator, mouse-over, accent, dark accent, selection, selection with focus, unread counter (background and text). Light and dark are edited separately (they follow the color scheme of the operating system). Only colors that differ from the theme are stored, all others keep following the theme. The four colors of dialogs, settings and compose window are listed in the same tab. Works live with the NovaBird themes (the theme's `--ms-*` variables are overridden with a user style sheet, also in the folder, list and message panes); with another theme the main-window part has no effect and the tab says so. Icons keep the colors drawn into them by the theme.
- **Fonts:** everything NovaBird sets can be changed in percent of the former size (100 %), with the resulting pixel size shown: font family, folder row height and message list spacing in the main window (themes); base size, subject, labels/command bar and sample text in the compose window; settings and accounts pages; Nova-Contact. The main window and Nova-Contact change live, compose window and settings pages when they are opened next.
- **This settings page** is 17 % larger. The system font it used before is very small on Windows (about 8 px).
- Technical: new experiment functions `settingsRedesign.getThemeColors`, `setMainStyle`, `setFonts`; compose and settings style sheets use factors (`--tbsr-fp`, `--tbsr-m-*`, `--tbsr-fe`).

### NovaBird-Extension 1.9.29
- **Compose window, sizes:** one base size for everything (menu bar, buttons, From line, recipient fields, formatting menus): 13.3 px at least (95 % of the former 14 px). The rest are fixed ratios of it: labels and Cc/Bcc 0.93, subject 1.14, sample text 1.29, font list 1.07. Before, the labels of the buttons stayed on a larger step than the labels of the header rows.
- **Compose window follows Thunderbird's font size setting** (three-lines menu): Thunderbird's own interface uses the set value directly in px (measured: default 8.4 px, setting 12 → 12 px). The base stays at 13.3 px and grows with the setting above that. Before, a fixed 14 px base from `shell.css` did not move with the setting.
- **Compose window, command bar:** text of the buttons (Send, Spelling, Save, Contacts, Attach, add-on buttons) at 0.93 of the base, the menu bar stays at the base size.
- **Compose window, heights:** command bar and formatting area about 12 % lower (less padding around the buttons and below the sample row).
- **Nova-Contact:** all font sizes in `rem` (default font of the page; Windows: 1 rem = 17 px, same size as before).

### NovaBird-Extension 1.9.22
- **New, opt-in: AI summary.** New settings tab "AI" with an on/off switch (off by default): while it is off, the button "Summarise mail (AI)" is hidden in the message header and NovaBird-Conversation shows no summary button. Further settings: interface (Ollama or OpenAI-compatible), address, model, optional user name and password or API key, context length (4k / 16k / 32k / 64k) and the language of the summary. A button "Summarise mail (AI)" in the message header opens a window with a live summary; NovaBird-Conversation offers the same for a whole conversation. Nothing is sent until you click; the text only goes to the address you entered (shown as a warning when it is not on this computer). Requests to the own computer are sent without the `moz-extension://` origin header, because Ollama refuses it with 403 (new permissions `webRequest` / `webRequestBlocking` for `localhost` / `127.0.0.1` only).
- The instruction to the model is shown and explained in the settings. It names the mail text as untrusted third-party data between markers with a random ID, forbids following instructions inside it and fixes the output form; a notice appears above the summary when the mail contains typical injected instructions. This reduces, but cannot exclude, prompt injection.
- Credentials are stored unencrypted in the add-on's profile data (stated in the settings).
- **Compose window, formatting bar:** one tinted surface that stands out from the message text. An arrow at the left expands a second row with a sample text (the state is remembered). The font menu moved to the front. The font size is a number (8–72 pt) instead of the three size buttons. The font menu opens as a scrollable list; hovering a font shows it in the sample text, which moves to the right of the list while it is open and is cut off instead of widening the window. Buttons of other add-ons in the command bar (for example LanguageTool) move into the formatting bar. If anything fails the stock bar stays as it is.
- **Compose window, header rows:** From / To / Subject are lower; the height is now in `em` (`2.5em` instead of 46 px).
- **New tab "Mailbox" in the settings:** mailbox analysis per account and in total with folders, messages and size (MB/GB), a size distribution bar and the largest folders, in the account colours of the message list. Read-only, calculated from the locally stored folder data (new experiment `mailStats`); for IMAP accounts without offline storage only what is stored locally counts.

### Docs
- `docs/windows-menue-rand.md`: wide border around menus on Windows (themes Sand 1.0.1, Cobalt 1.0.3, Springlight 1.7.3, already part of this branch).

## 1.2.1 (2026-10-14)
Hotfix: DB 1.2.5 · unchanged: Search 1.2.6 · Conversation 0.14.10 · Send 1.0.4 · Extension 1.9.15 · Sand 1.0.1 · Cobalt 1.0.3 · Springlight 1.7.3

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
