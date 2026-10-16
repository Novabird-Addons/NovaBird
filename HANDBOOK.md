# NovaBird – Short Handbook

NovaBird is a family of add-ons for **Betterbird** (and Thunderbird ESR, version 128 or newer). The add-ons work on their own and complement each other. This handbook is deliberately short; details are in each add-on's README. A German version is in [HANDBUCH.md](HANDBUCH.md).

> The add-ons only run in **Betterbird** or **Thunderbird ESR**, not in the monthly Thunderbird release. All packages are unsigned.

## 1. Overview

| Add-on | What it does |
|---|---|
| **NovaBird-Search** | One search bar instead of two, results while you type, strictly by date |
| **NovaBird-DB** | Own search index (fast, finds word parts and sentences); the base for Search and Conversation |
| **NovaBird-Conversation** | All messages of a conversation in the reading pane |
| **NovaBird-Send** | Sending with an undo window and a queue |
| **NovaBird-Extension** | Right pane (agenda, tasks, attachments), attachment preview, Nova-Contact, rule assistant (beta), settings in the new style |
| **NovaBird-Sand / -Cobalt / -Springlight** | Themes (light and dark) |

## 2. Install

> **Please read the [disclaimer](README.md#disclaimer) first:** unofficial, experimental, use at your own risk, back up your profile.

1. **Remove old add-ons** if present (Such-Pilot, DB-Pilot, Sende-Pilot, Conversation-Pilot, Stream Extension, Kalender-/Kontakt-Pilot, Stream themes). Never run an old and a new version of the same add-on together.
2. Open the **add-ons manager** (menu → Add-ons and Themes), gear → **Install Add-on From File…**, choose the `.xpi`. Suggested order: **DB**, Search, Conversation, Send, Extension. Install themes under *Themes* and enable one. **Faster:** select all `.xpi` files at once in the file dialog (Ctrl+A) or drag them all onto the add-ons manager; Betterbird then asks once per add-on (order does not matter).
3. **Restart Betterbird.**
4. **First start with NovaBird-DB:** the search index is built once (about 6 minutes for 75,000 messages). A progress window shows the state. Betterbird stays usable; search uses Betterbird's own index meanwhile (a hint appears in the bar). You can pause and resume at any time.

After updating a version, restart Betterbird, otherwise the old one stays active.

## 3. All settings in one place

With the **NovaBird-Extension**: **Settings → NovaBird** (left list). There is one tab per installed add-on: Search, Database, Conversation, Send, Extension. They are the same settings as in the add-ons manager. Every option is explained, important ones with a small sketch. Changes apply immediately.

## 4. Searching (NovaBird-Search + NovaBird-DB)

- **Type** in the bar above the message list (Ctrl+K jumps there). On the left you choose *All folders* or *Current folder*. From three characters on, results appear while you type (Enter forces shorter terms).
- **Gear:** search in From / To / Subject / Message, only with attachment, only unread, trash, spam. **Chips:** All, Today, 3, 7, 30 days.
- **Enter** asks (and can remember): *Filter* (results in a new tab where you can narrow further) or *Analyze* (analysis page with timeline and filters).
- **"Did you mean …?"** on zero results, **history** below the field.
- **Shared folders** (top of the folder pane): Shared inbox, All unread, Follow-up (add a message by right-click).

### Short syntax (always, in any language)

| Purpose | English | German | French | Spanish |
|---|---|---|---|---|
| Sender | `from:` | `von:` | `de:` | `de:` |
| Recipient | `to:` | `an:` | `à:` `pour:` | `para:` |
| Subject | `subject:` | `betreff:` | `objet:` `sujet:` | `asunto:` |
| Text | `text:` `body:` | `text:` | `texte:` | `texto:` |
| Attachment | `attachment:yes` | `anh:ja` | `pj:oui` | `adjunto:sí` |
| From date | `since:` `after:` | `seit:` `ab:` | `depuis:` | `desde:` |
| To date | `until:` `before:` | `bis:` | `jusque:` `avant:` | `hasta:` |
| Status | `unread` `flagged` | `ungelesen` `markiert` | `nonlu` `marqué` | `noleído` `marcado` |
| Scope | – | `hier` `überall` | `ici` `partout` | `aquí` |

Dates: `2026-01-31`, `31.01.2026`, `31/01/2026` or relative `7t` (days), `3w`, `6m`, `1j`.

### Sentences (with NovaBird-DB)

These work equally in English, German, French and Spanish:

- "invoices from Maya in the last 6 months" · "Rechnungen von Maya aus den letzten 6 Monaten" · "factures de Maya des 6 derniers mois" · "facturas de Maya en los últimos 6 meses"
- "unread mail with attachment since March"
- "what did Jonas send me"

Understood: people (from, to, "from me"), periods (yesterday, last week, in May 2025, between …), attachments (with PDF, without attachment), status, folders, "or" and negation ("without"). German compound words are found ("Speiseplan" finds "Wochenspeiseplan").

**Search language:** the default is English plus the language of Betterbird (German Betterbird: German and English). You can change this in the NovaBird-DB settings; with several languages, short ambiguous words such as "an" may be misread. French and Spanish are not yet reviewed by native speakers.

## 5. Reading conversations (NovaBird-Conversation)

When you open a message, **all messages of the conversation** appear (across folders, including Sent): the newest pinned on top, older ones as a row with a preview, unread and the latest ones expanded. A click expands or collapses.

- **Per message:** Reply, Reply all, Forward, Edit as new, Delete, Spam. **Original view** shows Betterbird's own view.
- **Expand while scrolling** (option): the row under the pointer opens when the pointer rests for a moment (50–200 ms).
- **Styles:** Soft, Clear, Thread. External images load only after your click.
- It also works without NovaBird-DB (via Gloda), just a bit slower.

## 6. Undo send (NovaBird-Send)

After **Send** the compose window disappears and a countdown runs at the bottom of the main window (default 10 s).

- **Undo** brings the window back unchanged. **Send now** skips the wait.
- Several messages go into a **queue**.
- **Quitting** during the wait saves the messages as drafts. On send errors the window comes back.
- Not affected: "Send later" and sending while offline.

## 7. Right pane, preview, contacts (NovaBird-Extension)

- **Right pane** in mail, calendar and tasks: agenda, tasks and an **attachments panel** (attachments of the selected message or of the thread; a click jumps to the message). Optionally the Betterbird default.
- **Attachment preview:** hold the mouse over a PDF or image attachment (right pane, message header, Conversation chips) and a scrollable preview opens.
- **Rule assistant (beta, off by default):** switch it on in the Extension settings under "Rules (beta)". Right-click a mail in the list → "Create rule from this mail …": choose a condition (this sender, this domain, subject, recipient), see which inbox mails match, pick actions (move, tag, mark read, star, trash) and save. It creates a normal Betterbird filter (Tools → Message Filters); existing filters are left untouched and backed up first.
- **Nova-Contact** (address book tab): tags as filters, edit several contacts at once, undo recent changes, and a "✦ Nova-Contact" button to collect, merge and clean up (with a restore point).
- Settings, accounts and the add-ons manager in the unified style; colors from the theme.

## 8. Themes

NovaBird-Sand (calm, warm), -Cobalt (compact, strong), -Springlight (light, fresh). Each follows the light/dark mode of the operating system. The Extension carries the theme colors into dialogs, settings and the right pane.

## 9. Privacy

- Everything runs **locally**. No add-on uses the network (only Conversation loads external images, and only after your click). One optional exception: the **AI summary** of NovaBird-Extension (Settings → NovaBird → Extension → AI) is off until you switch it on in the settings and enter the address of a language-model server (Ollama or an OpenAI-compatible service). Only when you click "Summarise mail (AI)" does the text of that message go to that address. With Ollama on your own computer it does not leave your computer; with a remote server it does, and the settings page says so. Credentials are stored unencrypted in the add-on's profile data.
- The **search index** sits unencrypted in your profile folder (`novabird-db/index.sqlite`) and contains mail text and attachment names, like Betterbird's own index. If you back up your profile or do not encrypt your disk, the mail text is included. NovaBird-DB → "Delete index" removes it.
- NovaBird-DB keeps confirmed search queries **locally** (to improve the parser later; nothing leaves your computer). You can switch this off and clear it under NovaBird-DB → "Search log".

## 10. When something does not work

| Problem | Remedy |
|---|---|
| Add-on shown as "corrupt" or "incompatible" | Are you running Betterbird / Thunderbird **ESR**? The add-ons need experiment APIs and do not work in the release channel. |
| Search bar says "Gloda search" | NovaBird-DB is missing, still building or damaged: Settings → NovaBird → Database; "Rebuild index" keeps the old one until the end. |
| "NovaBird" settings page missing or empty | NovaBird-Extension installed and Betterbird restarted? Tabs only appear for active add-ons. |
| Indexing stalls or never finishes (log shows "No progress for … s" or "Mail skipped") | **Repair the affected folder first:** right-click the folder → Properties → **Repair Folder**; repair all local folders if unsure. Then use "Check index now" in Settings → NovaBird → Database. For more detail switch on the detailed index log there. |
| Settings page of an add-on says "Not all features available" (usually after a Betterbird update) | The add-on found that Betterbird changed something it relies on; only the listed features are switched off, everything else works. Look for a newer NovaBird version. |
| Nothing changes after an update | Restart Betterbird once. |
| Quitting takes unusually long | Wait briefly (waiting mails in NovaBird-Send are saved as drafts first). If it hangs, open the error console and keep the messages containing "NovaBird" ready. |
| Reporting a problem | **Error console** (Ctrl+Shift+J), copy messages containing "NovaBird"; say which add-on, what you expected, what happened. Do not attach mail or addresses. |

## 11. Known limits

- The sentence parser is rule-based. Rare phrasings are not recognised; the short syntax always works.
- Colourful newsletters look deliberately plain in the conversation view ("Original view" shows them as usual).
- Preview exists only for PDF and images.
- IMAP messages that are not stored locally are indexed with headers only.

License: MIT (see `LICENSE`).
