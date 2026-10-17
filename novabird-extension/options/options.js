"use strict";

// Texte: Deutsch, Englisch, Französisch, Spanisch (Sprache der Betterbird-Oberfläche, sonst Englisch)
const TEXTS = {
  de: {
    // Selbsttest (Hinweis oben, shared/selftest-ui.js)
    selfTestTitle: "Nicht alle Funktionen verfügbar",
    selfTestText: "Diese Version passt nicht vollständig zu $1. Folgendes ist deshalb ausgeschaltet:",
    selfTestHint: "Alles andere funktioniert normal. Eine neuere Version des Add-ons behebt das in der Regel.",
    selfTest_listCards: "Nachrichtenliste: Stile, Vorschau und Avatare",
    selfTest_calendarLayout: "Kalender-Layout der rechten Leiste",
    selfTest_contacts: "Nova-Contact (Kontakte, Tags)",
    selfTest_contactDetails: "Tags in der Kontakt-Detailansicht",
    selfTest_contactTags: "Tag-Filter im Adressbuch",
    listStyleTitle: "Stil",
    listDensityTitle: "Dichte",
    dAiry: "Luftig",
    dAiryDesc: "Wie bisher: Avatar, Vorschauzeile und großzügige Abstände (Standard).",
    dNormal: "Normal",
    dNormalDesc: "Zwei Zeilen ohne Vorschau, Avatar möglich: etwa 40 % mehr Nachrichten sichtbar.",
    dCompact: "Kompakt",
    dCompactDesc: "Eine Zeile pro Nachricht wie in einer Tabelle: bis zu dreimal so viele Nachrichten sichtbar. Sanft und Faden erscheinen dabei im Aufbau von Klar.",
    listAcctTitle: "Kontofarbe",
    aNone: "Aus",
    aNoneDesc: "Keine Kennzeichnung des Kontos.",
    aBar: "Farbbalken",
    aBarDesc: "Schmaler Balken am linken Rand der Zeile (in Kompakt immer diese Form).",
    aRing: "Ring",
    aRingDesc: "Ring um den Avatar (nur Sanft mit Avatar, nicht in Kompakt; sonst Balken).",
    aDot: "Punkt mit Kontoname",
    aDotDesc: "Farbiger Punkt und Kontoname vor dem Betreff (in Kompakt als Balken).",
    listAcctColorsLabel: "Farbe je Konto:",
    listScrollLabel: "Breitere Scrollleisten (leichter zu treffen)",
    listAcctNote: "Die Farben werden automatisch vergeben und lassen sich hier ändern.",
    listDetailsTitle: "Weitere Optionen",
    listDensityNote: "Dichte und Kontofarbe gelten nicht für den Betterbird-Standard.",
    title: "NovaBird-Extension",
    tabPreview: "Anhang-Vorschau",
    tabList: "Nachrichtenliste",
    listTitle: "Aussehen der Nachrichtenliste",
    listIntro: "Gilt für die Kartenansicht der Nachrichtenliste (Einstellung „Ansicht“ → Karten). Die Tabellenansicht bleibt unverändert.",
    listDefault: "Betterbird-Standard",
    listSoft: "Sanft",
    listClear: "Klar",
    listDefaultDesc: "Unverändert: Absender, Betreff und Datum in zwei bis drei Zeilen.",
    listSoftDesc: "Runde Karten mit Avatar (Initialen), Betreff und einer Vorschauzeile; Ungelesenes mit Punkt.",
    listClearDesc: "Eine flache Zeile pro Nachricht: Absender, Betreff, Vorschau und Datum. Dicht und übersichtlich.",
    listThread: "Faden",
    listThreadDesc: "Zeitleiste: Datum links, Linie mit Punkten, Karte mit Betreff und Vorschauzeile; eigene Nachrichten getönt.",
    listPreviewLabel: "Vorschauzeile aus dem Nachrichtentext anzeigen",
    listAvatarsLabel: "Avatar mit Initialen anzeigen (nur Sanft)",
    listNote: "Die Vorschau wird nur für lokal gespeicherte Nachrichten angezeigt, damit nichts vom Server nachgeladen werden muss. Datum kurz (Uhrzeit, Wochentag, Datum). Änderungen wirken sofort.",
    previewTitle: "Vorschau von PDF- und Bild-Anhängen",
    previewEnableLabel: "Vorschau beim Überfahren anzeigen",
    previewDesc: "Zeigt beim Überfahren eines Anhangs mit der Maus – in der Anhangsliste der Mail, im Anhänge-Bereich der rechten Leiste und (falls installiert) in der Konversationsansicht – das PDF oder Bild in einem scrollbaren Fenster neben dem Anhang. „Öffnen“ im Fenster öffnet den Anhang in einem eigenen Tab. Es wird nichts heruntergeladen oder verändert.",
    previewDelayLabel: "Verzögerung bis zur Vorschau:",
    tabRules: "Regeln (Beta)",
    rulesTitle: "Regel-Assistent (Beta)",
    rulesEnableLabel: "Regel-Assistent verwenden",
    rulesDesc: "Legt Nachrichtenfilter Schritt für Schritt an, mit Erklärungen und einer Vorschau, welche Mails im Posteingang passen würden. Eingeschaltet erscheint im Kontextmenü der Nachrichtenliste „Regel aus dieser Mail erstellen …“. Gespeichert wird ein normaler Betterbird-Filter (Extras → Nachrichtenfilter), der auch ohne NovaBird weiterläuft; bestehende Filter bleiben unverändert, vorher wird die Filterdatei gesichert.",
    rulesOpen: "Regel-Assistent öffnen",
    selfTest_rules: "Regel-Assistent (Nachrichtenfilter)",
    tabStats: "Postfach",
    statsTitle: "Postfachanalyse",
    statsRefresh: "Aktualisieren",
    statsUpdated: "Stand: $1",
    statsNote: "Berechnet aus den lokal gespeicherten Daten, nichts wird nachgeladen. Bei IMAP-Konten ohne Offline-Speicherung zählt nur, was lokal liegt.",
    statsAccounts: "Konten",
    statsFolders: "Ordner",
    statsMessages: "Nachrichten",
    statsTotal: "Gesamtgröße",
    statsPerAccount: "Pro Konto",
    statsDistribution: "Verteilung nach Größe",
    statsTop: "Größte Ordner",
    statsLoading: "Wird berechnet …",
    statsError: "Die Analyse ist fehlgeschlagen.",
    statsEmpty: "Keine Konten gefunden.",
    statsFoldersN: "$1 Ordner",
    statsMessagesN: "$1 Nachrichten",
    selfTest_mailStats: "Postfachanalyse",
    tabAi: "KI",
    aiTitle: "KI-Zusammenfassung",
    aiDesc: "Fasst eine geöffnete Nachricht mit einem Sprachmodell zusammen. Nichts geschieht automatisch: Erst der Knopf „Mail zusammenfassen (KI)“ in der Nachrichtenansicht sendet den Mailtext an die Adresse unten. Gedacht für ein Modell auf dem eigenen Rechner (Ollama) oder einen OpenAI-kompatiblen Dienst.",
    aiCtxLabel: "Kontextlänge (Token)",
    aiPromptTitle: "Anweisung an die KI",
    aiPromptDesc: "Das ist der Text, den das Modell zusammen mit der Mail erhält. Er steht vor dem Mailtext und lässt sich hier nicht ändern. Platzhalter: {ZIEL} wird zur gewählten Sprache, {OPEN} und {CLOSE} sind Markierungen mit zufälliger Kennung, zwischen denen der Mailtext steht.",
    aiPromptSafe: ["Trennung: Der Mailtext steht zwischen Markierungen, die bei jeder Anfrage neu und zufällig sind. Ein Absender kann sie nicht vorhersagen und damit nicht aus dem Textteil ausbrechen.", "Fremde Daten: Das Modell erfährt ausdrücklich, dass der Mailtext von Dritten stammt und Anweisungen darin nicht befolgt werden dürfen. Das macht Fremdanweisungen unwahrscheinlicher, schließt sie bei Sprachmodellen aber nicht sicher aus.", "Begrenzte Wirkung: Das Modell hat keine Werkzeuge. Es kann nichts senden, öffnen oder löschen; seine Antwort wird nur als Text angezeigt. Im schlimmsten Fall ist eine Zusammenfassung falsch oder irreführend.", "Hinweis: Enthält eine Mail Sätze wie „ignoriere alle Anweisungen“, erscheint über der Zusammenfassung eine Warnung."],
    aiEnabledLabel: "KI-Zusammenfassung verwenden (der Knopf „Mail zusammenfassen (KI)“ erscheint nur, wenn dies an ist)",
    aiTypeLabel: "Schnittstelle",
    aiUrlLabel: "Adresse",
    aiModelLabel: "Modell",
    aiUserLabel: "Benutzername (optional)",
    aiKeyLabel: "Passwort oder API-Schlüssel (optional)",
    aiLangLabel: "Zusammenfassung in",
    aiLangUi: "Sprache der Oberfläche",
    aiLangMail: "Sprache der Mail",
    aiTest: "Verbindung testen",
    aiTesting: "Wird geprüft …",
    aiOk: "Verbunden: $1 Modelle gefunden.",
    aiFail: "Fehlgeschlagen: $1",
    aiPerm: "Erlaubnis für diese Adresse nicht erteilt.",
    aiRemote: "Achtung: Diese Adresse liegt nicht auf diesem Rechner. Beim Zusammenfassen wird der Text der Mail dorthin gesendet.",
    aiNote: "Zugangsdaten werden im Profil dieses Add-ons gespeichert (nicht verschlüsselt). Mit Benutzername wird Basic-Anmeldung verwendet, sonst das Passwort als Bearer-Schlüssel. Empfohlen: Ollama mit einem Modell wie gemma3:12b oder qwen3.5:9b.",
    tabPilot: "Nova-Contact",
    pilotTitle: "Nova-Contact im Kontakte-Tab",
    pilotEnableLabel: "Nova-Contact verwenden",
    pilotDesc: "Ergänzt den Kontakte-Tab von Betterbird: Tags als Filter, mehrere Kontakte gemeinsam bearbeiten (Tags, Firma, Position) und die letzten 3 Änderungen rückgängig machen. Der Knopf „Nova-Contact“ unter der Adressbuchliste öffnet die Seite zum Sammeln von Adressen aus E-Mails, zum Zusammenführen von Dubletten und zum Aufräumen alter Kontakte (mit Wiederherstellung).",
    pilotLogLabel: "Protokoll in der Nova-Contact-Seite anzeigen (Aktionen mit Uhrzeit, nur bis zum Neustart gespeichert)",
    tabCalendar: "Rechte Leiste",
    tabColors: "Farben und Schrift",
    layoutTitle: "Layout der rechten Leiste",
    layoutNova: "NovaBird-Layout: Termine und Aufgaben gemeinsam in Mail, Kalender und Aufgaben (Standard)",
    layoutDefault: "Betterbird-Standard",
    agendaTitle: "Terminliste (rechter Bereich)",
    agendaLabel: "Tage anzeigen (heute plus folgende, 1 = nur heute):",
    attachTitle: "Mailansicht – Tab rechts",
    attachLabel: "Anhänge der Nachricht oder der ganzen Unterhaltung unter dem Tagesplan auflisten (Teiler verschiebbar)",
    resetAttach: "Teiler zurücksetzen",
    calTab: "Kalender-Tab",
    mailTab: "Mail-Tab",
    diagTitle: "Diagnose",
    diagBtn: "Status anzeigen",
    colorTitle: "Custom Colors (eigene Farben)",
    modeTheme: "Farben des Themes übernehmen",
    modeCustom: "Eigene Farben",
    bgLabel: "Hintergrund",
    fgLabel: "Schrift",
    borderLabel: "Linien und Rahmen",
    accentLabel: "Akzent (Auswahl, Reiter, Hervorhebung)",
    reset: "Farben zurücksetzen",
    cfEdit: "Bearbeiten für:",
    cfLight: "Hell",
    cfDark: "Dunkel",
    cfNote: "Hell und Dunkel folgen dem Farbschema des Betriebssystems. Nur geänderte Farben werden gespeichert, alle anderen folgen dem Theme.",
    cfHint: "Mit der Maus über eine Farbe fahren: der betroffene Bereich wird in der Skizze umrandet. Die Skizze zeigt die Farben des gewählten Modus.",
    cfNoTheme: "Das aktive Theme ist kein NovaBird-Theme. Die Farben des Hauptfensters (links, oben) wirken nur mit Sand, Cobalt oder Springlight; Dialoge, Einstellungen und Verfassen-Fenster funktionieren mit jedem Theme.",
    g_areas: "Hauptfenster: Flächen",
    g_text: "Hauptfenster: Text und Linien",
    g_accent: "Auswahl und Akzent",
    g_dialog: "Dialoge, Einstellungen, Verfassen",
    c_spaces: "Spaces-Leiste",
    cd_spaces: "Schmale Icon-Leiste ganz links (Mail, Kalender, Adressbuch)",
    c_toolbar: "Werkzeugleiste",
    cd_toolbar: "Obere Leiste mit Schaltflächen und Suchfeld",
    c_sidebar: "Ordnerbereich",
    cd_sidebar: "Hintergrund der Ordnerliste",
    c_list: "Nachrichtenliste und -ansicht",
    cd_list: "Hintergrund, auf dem Nachrichten stehen und gelesen werden",
    c_text: "Text",
    cd_text: "Betreff, Absender und Haupttext",
    c_muted: "Zweittext",
    cd_muted: "Datum, Vorschau, Kontenüberschriften im Ordnerbereich",
    c_sidebarText: "Ordnertext",
    cd_sidebarText: "Namen der Ordner",
    c_border: "Rahmen",
    cd_border: "Trennlinien zwischen den Bereichen und um Felder",
    c_rowLine: "Zeilentrenner",
    cd_rowLine: "Feine Linie zwischen zwei Nachrichten",
    c_hover: "Maus darüber",
    cd_hover: "Zeile oder Ordner unter dem Mauszeiger",
    c_accent: "Akzent",
    cd_accent: "Auswahlbalken, Links und aktive Symbole",
    c_accentDark: "Akzent dunkel",
    cd_accentDark: "Text des gewählten Ordners",
    c_accentSoft: "Auswahl",
    cd_accentSoft: "Hintergrund des gewählten Ordners",
    c_accentFocus: "Auswahl mit Fokus",
    cd_accentFocus: "Gewählte Nachricht in der Liste",
    c_count: "Ungelesen-Zähler",
    cd_count: "Pille mit der Zahl (links Fläche, rechts Schrift)",
    cd_dbg: "Termin-Dialoge, Einstellungen, Konten und Verfassen-Fenster",
    cd_dfg: "Text in diesen Fenstern",
    cd_dborder: "Linien und Feldränder darin",
    cd_daccent: "Schalter, Schaltflächen und Auswahl darin",
    fontTitle: "Schrift",
    fontIntro: "100 % ist die bisherige Größe. Die Pixelwerte darunter gelten bei Thunderbirds Standard-Schriftgröße.",
    fontNew: "Verfassen-Fenster, Einstellungen und Konten übernehmen Änderungen beim nächsten Öffnen.",
    fontReset: "Schrift zurücksetzen",
    fg_main: "Hauptfenster (Theme)",
    fg_compose: "Verfassen-Fenster",
    fg_other: "Weitere Seiten",
    famTheme: "Theme-Standard",
    famSystem: "System",
    f_family: "Schriftart",
    fd_family: "Alle Beschriftungen im Hauptfenster: Ordner, Liste, Leisten",
    f_row: "Zeilenhöhe Ordnerliste",
    fd_row: "Höhe eines Ordners im Ordnerbereich",
    f_pad: "Abstand Nachrichtenliste",
    fd_pad: "Luft um Absender und Betreff",
    f_compose: "Grundschrift",
    fd_compose: "Menüs, Felder und Knöpfe; mindestens 13,3 px, wächst mit Thunderbirds Schriftgröße",
    f_subject: "Betreff",
    fd_subject: "Betreff-Zeile",
    f_labels: "Beschriftungen und Befehlsleiste",
    fd_labels: "„An“, „Cc“, Anhänge und die Leiste mit „Senden“",
    f_sample: "Beispieltext der Formatierungsleiste",
    fd_sample: "Vorschau der Schrift beim Aufklappen",
    f_settings: "Einstellungen und Konten",
    fd_settings: "Menü und Inhalt dieser Seiten",
    f_contact: "Nova-Contact",
    fd_contact: "Seitenleiste und Kontaktseite",
    hint: "Änderungen wirken sofort; offene Fenster übernehmen sie beim nächsten Öffnen.",
  },
  en: {
    // Selbsttest (Hinweis oben, shared/selftest-ui.js)
    selfTestTitle: "Not all features available",
    selfTestText: "This version does not fully match $1. The following is therefore switched off:",
    selfTestHint: "Everything else works normally. A newer version of the add-on usually fixes this.",
    selfTest_listCards: "Message list: styles, preview and avatars",
    selfTest_calendarLayout: "Calendar layout of the right sidebar",
    selfTest_contacts: "Nova-Contact (contacts, tags)",
    selfTest_contactDetails: "Tags in the contact detail view",
    selfTest_contactTags: "Tag filter in the address book",
    listStyleTitle: "Style",
    listDensityTitle: "Density",
    dAiry: "Airy",
    dAiryDesc: "As before: avatar, preview line and generous spacing (default).",
    dNormal: "Normal",
    dNormalDesc: "Two lines without preview, avatar possible: about 40% more messages visible.",
    dCompact: "Compact",
    dCompactDesc: "One line per message like a table: up to three times as many messages visible. Soft and Thread then use the layout of Clear.",
    listAcctTitle: "Account colour",
    aNone: "Off",
    aNoneDesc: "No account marking.",
    aBar: "Colour bar",
    aBarDesc: "Narrow bar at the left edge of the row (always used in Compact).",
    aRing: "Ring",
    aRingDesc: "Ring around the avatar (Soft with avatar, not in Compact; otherwise a bar).",
    aDot: "Dot with account name",
    aDotDesc: "Coloured dot and account name before the subject (a bar in Compact).",
    listAcctColorsLabel: "Colour per account:",
    listScrollLabel: "Wider scrollbars (easier to hit)",
    listAcctNote: "Colours are assigned automatically and can be changed here.",
    listDetailsTitle: "More options",
    listDensityNote: "Density and account colour do not apply to the Betterbird default.",
    title: "NovaBird-Extension",
    tabPreview: "Attachment preview",
    tabList: "Message list",
    listTitle: "Look of the message list",
    listIntro: "Applies to the cards view of the message list (View setting → Cards). The table view stays unchanged.",
    listDefault: "Betterbird default",
    listSoft: "Soft",
    listClear: "Clear",
    listDefaultDesc: "Unchanged: sender, subject and date in two or three lines.",
    listSoftDesc: "Rounded cards with an avatar (initials), subject and a preview line; unread messages get a dot.",
    listClearDesc: "One flat line per message: sender, subject, preview and date. Dense and easy to scan.",
    listThread: "Thread",
    listThreadDesc: "Timeline: date on the left, a line with dots, a card with subject and preview line; your own messages tinted.",
    listPreviewLabel: "Show a preview line from the message text",
    listAvatarsLabel: "Show an avatar with initials (Soft only)",
    listNote: "The preview is shown for locally stored messages only, so nothing has to be fetched from the server. Short dates (time, weekday, date). Changes apply immediately.",
    previewTitle: "Preview of PDF and image attachments",
    previewEnableLabel: "Show preview on hover",
    previewDesc: "When you hover an attachment – in the message’s attachment list, in the right-hand attachments area and (if installed) in the conversation view – the PDF or image appears in a scrollable window next to it. “Open” in the window opens the attachment in its own tab. Nothing is downloaded or changed.",
    previewDelayLabel: "Delay before the preview:",
    tabRules: "Rules (beta)",
    rulesTitle: "Rule assistant (beta)",
    rulesEnableLabel: "Use the rule assistant",
    rulesDesc: "Creates message filters step by step, with explanations and a preview of which mails in the inbox would match. When enabled, the message list context menu offers \"Create rule from this mail …\". It saves a normal Betterbird filter (Tools → Message Filters) that keeps working without NovaBird; existing filters stay unchanged and the filter file is backed up first.",
    rulesOpen: "Open rule assistant",
    selfTest_rules: "Rule assistant (message filters)",
    tabStats: "Mailbox",
    statsTitle: "Mailbox analysis",
    statsRefresh: "Refresh",
    statsUpdated: "As of: $1",
    statsNote: "Calculated from locally stored data; nothing is downloaded. For IMAP accounts without offline storage only what is stored locally is counted.",
    statsAccounts: "Accounts",
    statsFolders: "Folders",
    statsMessages: "Messages",
    statsTotal: "Total size",
    statsPerAccount: "Per account",
    statsDistribution: "Distribution by size",
    statsTop: "Largest folders",
    statsLoading: "Calculating …",
    statsError: "The analysis failed.",
    statsEmpty: "No accounts found.",
    statsFoldersN: "$1 folders",
    statsMessagesN: "$1 messages",
    selfTest_mailStats: "Mailbox analysis",
    tabAi: "AI",
    aiTitle: "AI summary",
    aiDesc: "Summarises an open message with a language model. Nothing happens automatically: only the button “Summarise mail (AI)” in the message view sends the mail text to the address below. Meant for a model on your own computer (Ollama) or an OpenAI-compatible service.",
    aiCtxLabel: "Context length (tokens)",
    aiPromptTitle: "Instruction to the AI",
    aiPromptDesc: "This is the text the model receives together with the mail. It comes before the mail text and cannot be changed here. Placeholders: {ZIEL} becomes the chosen language, {OPEN} and {CLOSE} are markers with a random ID between which the mail text is placed.",
    aiPromptSafe: ["Separation: The mail text sits between markers that are new and random for every request. A sender cannot predict them and so cannot break out of the text part.", "Third-party data: The model is told explicitly that the mail text comes from others and that instructions in it must not be followed. This makes injected instructions less likely, but with language models it cannot rule them out completely.", "Limited effect: The model has no tools. It cannot send, open or delete anything; its answer is only shown as text. In the worst case a summary is wrong or misleading.", "Notice: If a mail contains sentences such as “ignore all instructions”, a warning appears above the summary."],
    aiEnabledLabel: "Use AI summary (the button “Summarise mail (AI)” only appears when this is on)",
    aiTypeLabel: "Interface",
    aiUrlLabel: "Address",
    aiModelLabel: "Model",
    aiUserLabel: "User name (optional)",
    aiKeyLabel: "Password or API key (optional)",
    aiLangLabel: "Summary in",
    aiLangUi: "Interface language",
    aiLangMail: "Language of the mail",
    aiTest: "Test connection",
    aiTesting: "Checking …",
    aiOk: "Connected: $1 models found.",
    aiFail: "Failed: $1",
    aiPerm: "Permission for this address was not granted.",
    aiRemote: "Note: this address is not on this computer. When summarising, the text of the mail is sent there.",
    aiNote: "Credentials are stored in this add-on’s profile data (not encrypted). With a user name Basic authentication is used, otherwise the password is sent as a bearer key. Recommended: Ollama with a model such as gemma3:12b or qwen3.5:9b.",
    tabPilot: "Nova-Contact",
    pilotTitle: "Nova-Contact in the Contacts tab",
    pilotEnableLabel: "Use Nova-Contact",
    pilotDesc: "Extends Betterbird’s Contacts tab: filter by tags, edit several contacts at once (tags, company, job title) and undo the last 3 changes. The “Nova-Contact” button below the address book list opens the page for collecting addresses from email, merging duplicates and cleaning up old contacts (with restore).",
    pilotLogLabel: "Show a log on the Nova-Contact page (actions with time, kept only until restart)",
    tabCalendar: "Right pane",
    tabColors: "Colors and fonts",
    layoutTitle: "Layout of the right-hand pane",
    layoutNova: "NovaBird layout: events and tasks together in mail, calendar and tasks (default)",
    layoutDefault: "Betterbird default",
    agendaTitle: "Event list (right-hand pane)",
    agendaLabel: "Days to show (today plus following, 1 = today only):",
    attachTitle: "Mail view – right-hand tab",
    attachLabel: "List attachments of the message or the whole conversation below the agenda (movable divider)",
    resetAttach: "Reset divider",
    calTab: "Calendar tab",
    mailTab: "Mail tab",
    diagTitle: "Diagnostics",
    diagBtn: "Show status",
    colorTitle: "Custom Colors",
    modeTheme: "Use the theme's colors",
    modeCustom: "Custom colors",
    bgLabel: "Background",
    fgLabel: "Text",
    borderLabel: "Lines and borders",
    accentLabel: "Accent (selection, tabs, highlight)",
    reset: "Reset colors",
    cfEdit: "Edit for:",
    cfLight: "Light",
    cfDark: "Dark",
    cfNote: "Light and dark follow the color scheme of the operating system. Only changed colors are saved, all others follow the theme.",
    cfHint: "Move the mouse over a color: the affected area is outlined in the sketch. The sketch shows the colors of the selected mode.",
    cfNoTheme: "The active theme is not a NovaBird theme. The colors of the main window (left, top) only work with Sand, Cobalt or Springlight; dialogs, settings and the compose window work with any theme.",
    g_areas: "Main window: areas",
    g_text: "Main window: text and lines",
    g_accent: "Selection and accent",
    g_dialog: "Dialogs, settings, compose",
    c_spaces: "Spaces bar",
    cd_spaces: "Narrow icon bar on the far left (mail, calendar, address book)",
    c_toolbar: "Toolbar",
    cd_toolbar: "Top bar with buttons and the search field",
    c_sidebar: "Folder pane",
    cd_sidebar: "Background of the folder list",
    c_list: "Message list and view",
    cd_list: "Background where messages are listed and read",
    c_text: "Text",
    cd_text: "Subject, sender and main text",
    c_muted: "Secondary text",
    cd_muted: "Date, preview, account headings in the folder pane",
    c_sidebarText: "Folder text",
    cd_sidebarText: "Names of the folders",
    c_border: "Border",
    cd_border: "Dividing lines between areas and around fields",
    c_rowLine: "Row separator",
    cd_rowLine: "Fine line between two messages",
    c_hover: "Mouse over",
    cd_hover: "Row or folder under the pointer",
    c_accent: "Accent",
    cd_accent: "Selection bar, links and active icons",
    c_accentDark: "Accent, dark",
    cd_accentDark: "Text of the selected folder",
    c_accentSoft: "Selection",
    cd_accentSoft: "Background of the selected folder",
    c_accentFocus: "Selection with focus",
    cd_accentFocus: "Selected message in the list",
    c_count: "Unread counter",
    cd_count: "Pill with the number (left background, right text)",
    cd_dbg: "Event dialogs, settings, accounts and compose window",
    cd_dfg: "Text in these windows",
    cd_dborder: "Lines and field borders in them",
    cd_daccent: "Switches, buttons and selection in them",
    fontTitle: "Fonts",
    fontIntro: "100 % is the former size. The pixel values below apply at Thunderbird's default font size.",
    fontNew: "Compose window, settings and accounts take changes the next time they are opened.",
    fontReset: "Reset fonts",
    fg_main: "Main window (theme)",
    fg_compose: "Compose window",
    fg_other: "Other pages",
    famTheme: "Theme default",
    famSystem: "System",
    f_family: "Font",
    fd_family: "All text in the main window: folders, list, bars",
    f_row: "Folder row height",
    fd_row: "Height of one folder in the folder pane",
    f_pad: "Message list spacing",
    fd_pad: "Space around sender and subject",
    f_compose: "Base size",
    fd_compose: "Menus, fields and buttons; at least 13.3 px, grows with Thunderbird's font size",
    f_subject: "Subject",
    fd_subject: "Subject line",
    f_labels: "Labels and command bar",
    fd_labels: "“To”, “Cc”, attachments and the bar with “Send”",
    f_sample: "Sample text of the formatting bar",
    fd_sample: "Preview of the font when the bar is expanded",
    f_settings: "Settings and accounts",
    fd_settings: "Menu and content of these pages",
    f_contact: "Nova-Contact",
    fd_contact: "Sidebar and contact page",
    hint: "Changes apply immediately; open windows pick them up the next time they open.",
  },
  fr: {
    // Selbsttest (Hinweis oben, shared/selftest-ui.js)
    selfTestTitle: "Certaines fonctions ne sont pas disponibles",
    selfTestText: "Cette version n’est pas entièrement compatible avec $1. Les fonctions suivantes sont donc désactivées :",
    selfTestHint: "Tout le reste fonctionne normalement. Une version plus récente du module corrige généralement ce problème.",
    selfTest_listCards: "Liste des messages : styles, aperçu et avatars",
    selfTest_calendarLayout: "Disposition du calendrier dans la barre de droite",
    selfTest_contacts: "Nova-Contact (contacts, tags)",
    selfTest_contactDetails: "Tags dans la vue détaillée du contact",
    selfTest_contactTags: "Filtre par tag dans le carnet d’adresses",
    listStyleTitle: "Style",
    listDensityTitle: "Densité",
    dAiry: "Aérée",
    dAiryDesc: "Comme avant : avatar, ligne d’aperçu et espacement généreux (par défaut).",
    dNormal: "Normale",
    dNormalDesc: "Deux lignes sans aperçu, avatar possible : environ 40 % de messages visibles en plus.",
    dCompact: "Compacte",
    dCompactDesc: "Une ligne par message comme dans un tableau : jusqu’à trois fois plus de messages visibles. Doux et Fil prennent alors la disposition de Clair.",
    listAcctTitle: "Couleur du compte",
    aNone: "Désactivée",
    aNoneDesc: "Aucun marquage du compte.",
    aBar: "Barre de couleur",
    aBarDesc: "Barre étroite au bord gauche de la ligne (toujours utilisée en mode compact).",
    aRing: "Anneau",
    aRingDesc: "Anneau autour de l’avatar (Doux avec avatar, pas en mode compact ; sinon une barre).",
    aDot: "Point avec nom du compte",
    aDotDesc: "Point coloré et nom du compte avant l’objet (une barre en mode compact).",
    listAcctColorsLabel: "Couleur par compte :",
    listScrollLabel: "Barres de défilement plus larges (plus faciles à atteindre)",
    listAcctNote: "Les couleurs sont attribuées automatiquement et modifiables ici.",
    listDetailsTitle: "Autres options",
    listDensityNote: "La densité et la couleur du compte ne s’appliquent pas au style par défaut de Betterbird.",
    title: "NovaBird-Extension",
    tabPreview: "Aperçu des pièces jointes",
    tabList: "Liste des messages",
    listTitle: "Apparence de la liste des messages",
    listIntro: "S’applique à l’affichage en cartes de la liste des messages (réglage Affichage → Cartes). L’affichage en tableau reste inchangé.",
    listDefault: "Standard de Betterbird",
    listSoft: "Doux",
    listClear: "Net",
    listDefaultDesc: "Inchangé : expéditeur, objet et date sur deux ou trois lignes.",
    listSoftDesc: "Cartes arrondies avec avatar (initiales), objet et une ligne d’aperçu ; les messages non lus ont un point.",
    listClearDesc: "Une ligne plate par message : expéditeur, objet, aperçu et date. Dense et lisible.",
    listThread: "Fil",
    listThreadDesc: "Chronologie : date à gauche, ligne avec points, carte avec objet et ligne d’aperçu ; vos propres messages teintés.",
    listPreviewLabel: "Afficher une ligne d’aperçu du texte du message",
    listAvatarsLabel: "Afficher un avatar avec les initiales (Doux uniquement)",
    listNote: "L’aperçu n’est affiché que pour les messages stockés localement, afin de ne rien télécharger depuis le serveur. Dates courtes (heure, jour, date). Les changements s’appliquent immédiatement.",
    previewTitle: "Aperçu des pièces jointes PDF et images",
    previewEnableLabel: "Afficher l’aperçu au survol",
    previewDesc: "Au survol d’une pièce jointe – dans la liste des pièces jointes du message, dans la zone des pièces jointes à droite et (si installée) dans la vue des conversations – le PDF ou l’image s’affiche dans une fenêtre défilante à côté. « Ouvrir » ouvre la pièce jointe dans un onglet. Rien n’est téléchargé ni modifié.",
    previewDelayLabel: "Délai avant l’aperçu :",
    tabRules: "Règles (bêta)",
    rulesTitle: "Assistant de règles (bêta)",
    rulesEnableLabel: "Utiliser l’assistant de règles",
    rulesDesc: "Crée des filtres de messages pas à pas, avec des explications et un aperçu des messages de la boîte de réception qui correspondraient. Une fois activé, le menu contextuel de la liste des messages propose « Créer une règle à partir de ce message … ». Il enregistre un filtre Betterbird normal (Outils → Filtres de messages) qui fonctionne aussi sans NovaBird ; les filtres existants restent inchangés et le fichier de filtres est sauvegardé avant.",
    rulesOpen: "Ouvrir l’assistant de règles",
    selfTest_rules: "Assistant de règles (filtres de messages)",
    tabStats: "Boîte mail",
    statsTitle: "Analyse de la boîte mail",
    statsRefresh: "Actualiser",
    statsUpdated: "État : $1",
    statsNote: "Calculé à partir des données stockées localement, rien n’est téléchargé. Pour les comptes IMAP sans stockage hors ligne, seul ce qui est local est compté.",
    statsAccounts: "Comptes",
    statsFolders: "Dossiers",
    statsMessages: "Messages",
    statsTotal: "Taille totale",
    statsPerAccount: "Par compte",
    statsDistribution: "Répartition par taille",
    statsTop: "Plus gros dossiers",
    statsLoading: "Calcul en cours …",
    statsError: "L’analyse a échoué.",
    statsEmpty: "Aucun compte trouvé.",
    statsFoldersN: "$1 dossiers",
    statsMessagesN: "$1 messages",
    selfTest_mailStats: "Analyse de la boîte mail",
    tabAi: "IA",
    aiTitle: "Résumé par IA",
    aiDesc: "Résume un message ouvert avec un modèle de langage. Rien n’est automatique : seul le bouton « Résumer le message (IA) » de l’affichage du message envoie le texte à l’adresse ci-dessous. Prévu pour un modèle sur votre propre ordinateur (Ollama) ou un service compatible OpenAI.",
    aiCtxLabel: "Longueur de contexte (jetons)",
    aiPromptTitle: "Instruction donnée à l’IA",
    aiPromptDesc: "Voici le texte que le modèle reçoit avec le message. Il précède le texte du message et ne peut pas être modifié ici. Espaces réservés : {ZIEL} devient la langue choisie, {OPEN} et {CLOSE} sont des marqueurs à identifiant aléatoire entre lesquels se trouve le texte du message.",
    aiPromptSafe: ["Séparation : le texte du message se trouve entre des marqueurs nouveaux et aléatoires à chaque requête. Un expéditeur ne peut pas les prévoir et donc pas sortir de la partie texte.", "Données de tiers : le modèle est informé expressément que le texte provient de tiers et que les instructions qu’il contient ne doivent pas être suivies. Cela rend les instructions injectées moins probables, mais avec des modèles de langage cela ne les exclut pas avec certitude.", "Effet limité : le modèle n’a aucun outil. Il ne peut rien envoyer, ouvrir ni supprimer ; sa réponse est seulement affichée comme texte. Au pire, un résumé est faux ou trompeur.", "Avertissement : si un message contient des phrases comme « ignore toutes les instructions », un avertissement apparaît au-dessus du résumé."],
    aiEnabledLabel: "Utiliser le résumé par IA (le bouton « Résumer le message (IA) » n’apparaît que si cette option est activée)",
    aiTypeLabel: "Interface",
    aiUrlLabel: "Adresse",
    aiModelLabel: "Modèle",
    aiUserLabel: "Nom d’utilisateur (facultatif)",
    aiKeyLabel: "Mot de passe ou clé API (facultatif)",
    aiLangLabel: "Résumé en",
    aiLangUi: "Langue de l’interface",
    aiLangMail: "Langue du message",
    aiTest: "Tester la connexion",
    aiTesting: "Vérification …",
    aiOk: "Connecté : $1 modèles trouvés.",
    aiFail: "Échec : $1",
    aiPerm: "L’autorisation pour cette adresse n’a pas été accordée.",
    aiRemote: "Attention : cette adresse n’est pas sur cet ordinateur. Lors du résumé, le texte du message y est envoyé.",
    aiNote: "Les identifiants sont enregistrés dans les données de profil de ce module (non chiffrés). Avec un nom d’utilisateur, l’authentification Basic est utilisée, sinon le mot de passe est envoyé comme clé Bearer. Recommandé : Ollama avec un modèle comme gemma3:12b ou qwen3.5:9b.",
    tabPilot: "Nova-Contact",
    pilotTitle: "Nova-Contact dans l’onglet Contacts",
    pilotEnableLabel: "Utiliser Nova-Contact",
    pilotDesc: "Complète l’onglet Contacts de Betterbird : filtrer par tags, modifier plusieurs contacts à la fois (tags, société, fonction) et annuler les 3 dernières modifications. Le bouton « Nova-Contact » sous la liste des carnets ouvre la page pour collecter des adresses depuis les e-mails, fusionner les doublons et nettoyer les anciens contacts (avec restauration).",
    pilotLogLabel: "Afficher un journal sur la page Nova-Contact (actions avec l’heure, conservé jusqu’au redémarrage)",
    tabCalendar: "Panneau de droite",
    tabColors: "Couleurs et police",
    layoutTitle: "Disposition du panneau de droite",
    layoutNova: "Disposition NovaBird : événements et tâches ensemble dans Courrier, Agenda et Tâches (par défaut)",
    layoutDefault: "Disposition standard de Betterbird",
    agendaTitle: "Liste des événements (panneau de droite)",
    agendaLabel: "Jours à afficher (aujourd'hui et suivants, 1 = aujourd'hui seulement) :",
    attachTitle: "Vue Courrier – onglet de droite",
    attachLabel: "Lister les pièces jointes du message ou de toute la conversation sous l'agenda (séparateur déplaçable)",
    resetAttach: "Réinitialiser le séparateur",
    calTab: "Onglet Agenda",
    mailTab: "Onglet Courrier",
    diagTitle: "Diagnostic",
    diagBtn: "Afficher l'état",
    colorTitle: "Custom Colors (couleurs personnalisées)",
    modeTheme: "Utiliser les couleurs du thème",
    modeCustom: "Couleurs personnalisées",
    bgLabel: "Arrière-plan",
    fgLabel: "Texte",
    borderLabel: "Lignes et bordures",
    accentLabel: "Accent (sélection, onglets, surbrillance)",
    reset: "Réinitialiser les couleurs",
    cfEdit: "Modifier pour :",
    cfLight: "Clair",
    cfDark: "Sombre",
    cfNote: "Clair et sombre suivent le schéma de couleurs du système. Seules les couleurs modifiées sont enregistrées, les autres suivent le thème.",
    cfHint: "Passez la souris sur une couleur : la zone concernée est entourée dans l'aperçu. L'aperçu montre les couleurs du mode choisi.",
    cfNoTheme: "Le thème actif n'est pas un thème NovaBird. Les couleurs de la fenêtre principale (à gauche, en haut) ne fonctionnent qu'avec Sand, Cobalt ou Springlight ; les dialogues, les paramètres et la fenêtre de rédaction fonctionnent avec tous les thèmes.",
    g_areas: "Fenêtre principale : surfaces",
    g_text: "Fenêtre principale : texte et lignes",
    g_accent: "Sélection et accent",
    g_dialog: "Dialogues, paramètres, rédaction",
    c_spaces: "Barre des espaces",
    cd_spaces: "Étroite barre d'icônes à gauche (courrier, agenda, carnet d'adresses)",
    c_toolbar: "Barre d'outils",
    cd_toolbar: "Barre du haut avec boutons et champ de recherche",
    c_sidebar: "Volet des dossiers",
    cd_sidebar: "Arrière-plan de la liste des dossiers",
    c_list: "Liste et affichage des messages",
    cd_list: "Arrière-plan où les messages sont listés et lus",
    c_text: "Texte",
    cd_text: "Objet, expéditeur et texte principal",
    c_muted: "Texte secondaire",
    cd_muted: "Date, aperçu, titres de comptes dans le volet des dossiers",
    c_sidebarText: "Texte des dossiers",
    cd_sidebarText: "Noms des dossiers",
    c_border: "Bordure",
    cd_border: "Lignes de séparation entre les zones et autour des champs",
    c_rowLine: "Séparateur de lignes",
    cd_rowLine: "Fine ligne entre deux messages",
    c_hover: "Survol",
    cd_hover: "Ligne ou dossier sous le pointeur",
    c_accent: "Accent",
    cd_accent: "Barre de sélection, liens et icônes actives",
    c_accentDark: "Accent foncé",
    cd_accentDark: "Texte du dossier sélectionné",
    c_accentSoft: "Sélection",
    cd_accentSoft: "Arrière-plan du dossier sélectionné",
    c_accentFocus: "Sélection avec focus",
    cd_accentFocus: "Message sélectionné dans la liste",
    c_count: "Compteur de non lus",
    cd_count: "Pastille avec le nombre (à gauche le fond, à droite le texte)",
    cd_dbg: "Dialogues d'événements, paramètres, comptes et fenêtre de rédaction",
    cd_dfg: "Texte dans ces fenêtres",
    cd_dborder: "Lignes et bordures de champs",
    cd_daccent: "Interrupteurs, boutons et sélection",
    fontTitle: "Police",
    fontIntro: "100 % correspond à la taille actuelle. Les valeurs en pixels valent pour la taille de police par défaut de Thunderbird.",
    fontNew: "La fenêtre de rédaction, les paramètres et les comptes appliquent les changements à la prochaine ouverture.",
    fontReset: "Réinitialiser la police",
    fg_main: "Fenêtre principale (thème)",
    fg_compose: "Fenêtre de rédaction",
    fg_other: "Autres pages",
    famTheme: "Défaut du thème",
    famSystem: "Système",
    f_family: "Police",
    fd_family: "Tout le texte de la fenêtre principale : dossiers, liste, barres",
    f_row: "Hauteur des lignes de dossiers",
    fd_row: "Hauteur d'un dossier dans le volet",
    f_pad: "Espacement de la liste",
    fd_pad: "Espace autour de l'expéditeur et de l'objet",
    f_compose: "Taille de base",
    fd_compose: "Menus, champs et boutons ; au moins 13,3 px, suit la taille de police de Thunderbird",
    f_subject: "Objet",
    fd_subject: "Ligne d'objet",
    f_labels: "Libellés et barre de commandes",
    fd_labels: "« À », « Cc », pièces jointes et la barre avec « Envoyer »",
    f_sample: "Texte d'exemple de la barre de mise en forme",
    fd_sample: "Aperçu de la police à l'ouverture de la barre",
    f_settings: "Paramètres et comptes",
    fd_settings: "Menu et contenu de ces pages",
    f_contact: "Nova-Contact",
    fd_contact: "Barre latérale et page des contacts",
    hint: "Les modifications s'appliquent immédiatement ; les fenêtres ouvertes les prennent en compte à la prochaine ouverture.",
  },
  es: {
    // Selbsttest (Hinweis oben, shared/selftest-ui.js)
    selfTestTitle: "No todas las funciones están disponibles",
    selfTestText: "Esta versión no es totalmente compatible con $1. Por eso está desactivado lo siguiente:",
    selfTestHint: "Todo lo demás funciona con normalidad. Una versión más reciente del complemento suele solucionarlo.",
    selfTest_listCards: "Lista de mensajes: estilos, vista previa y avatares",
    selfTest_calendarLayout: "Diseño del calendario en la barra derecha",
    selfTest_contacts: "Nova-Contact (contactos, etiquetas)",
    selfTest_contactDetails: "Etiquetas en la vista detallada del contacto",
    selfTest_contactTags: "Filtro por etiqueta en la libreta de direcciones",
    listStyleTitle: "Estilo",
    listDensityTitle: "Densidad",
    dAiry: "Amplia",
    dAiryDesc: "Como antes: avatar, línea de vista previa y espaciado generoso (predeterminada).",
    dNormal: "Normal",
    dNormalDesc: "Dos líneas sin vista previa, avatar posible: aproximadamente un 40 % más de mensajes visibles.",
    dCompact: "Compacta",
    dCompactDesc: "Una línea por mensaje como en una tabla: hasta tres veces más mensajes visibles. Suave e Hilo usan entonces la disposición de Claro.",
    listAcctTitle: "Color de la cuenta",
    aNone: "Desactivado",
    aNoneDesc: "Sin marca de cuenta.",
    aBar: "Barra de color",
    aBarDesc: "Barra estrecha en el borde izquierdo de la fila (siempre en el modo compacto).",
    aRing: "Anillo",
    aRingDesc: "Anillo alrededor del avatar (Suave con avatar, no en modo compacto; si no, una barra).",
    aDot: "Punto con nombre de cuenta",
    aDotDesc: "Punto de color y nombre de cuenta antes del asunto (una barra en modo compacto).",
    listAcctColorsLabel: "Color por cuenta:",
    listScrollLabel: "Barras de desplazamiento más anchas (más fáciles de alcanzar)",
    listAcctNote: "Los colores se asignan automáticamente y se pueden cambiar aquí.",
    listDetailsTitle: "Más opciones",
    listDensityNote: "La densidad y el color de la cuenta no se aplican al estilo predeterminado de Betterbird.",
    title: "NovaBird-Extension",
    tabPreview: "Vista previa de adjuntos",
    tabList: "Lista de mensajes",
    listTitle: "Aspecto de la lista de mensajes",
    listIntro: "Se aplica a la vista de tarjetas de la lista de mensajes (ajuste Vista → Tarjetas). La vista de tabla no cambia.",
    listDefault: "Estándar de Betterbird",
    listSoft: "Suave",
    listClear: "Claro",
    listDefaultDesc: "Sin cambios: remitente, asunto y fecha en dos o tres líneas.",
    listSoftDesc: "Tarjetas redondeadas con avatar (iniciales), asunto y una línea de vista previa; los no leídos llevan un punto.",
    listClearDesc: "Una línea plana por mensaje: remitente, asunto, vista previa y fecha. Compacta y clara.",
    listThread: "Hilo",
    listThreadDesc: "Línea de tiempo: fecha a la izquierda, línea con puntos, tarjeta con asunto y línea de vista previa; sus propios mensajes teñidos.",
    listPreviewLabel: "Mostrar una línea de vista previa del texto del mensaje",
    listAvatarsLabel: "Mostrar un avatar con iniciales (solo Suave)",
    listNote: "La vista previa solo se muestra para mensajes guardados localmente, para no descargar nada del servidor. Fechas cortas (hora, día de la semana, fecha). Los cambios se aplican de inmediato.",
    previewTitle: "Vista previa de adjuntos PDF e imágenes",
    previewEnableLabel: "Mostrar vista previa al pasar el ratón",
    previewDesc: "Al pasar el ratón sobre un adjunto – en la lista de adjuntos del mensaje, en el área de adjuntos de la derecha y (si está instalado) en la vista de conversaciones – el PDF o la imagen aparece en una ventana desplazable junto a él. «Abrir» abre el adjunto en una pestaña propia. No se descarga ni se modifica nada.",
    previewDelayLabel: "Retraso antes de la vista previa:",
    tabRules: "Reglas (beta)",
    rulesTitle: "Asistente de reglas (beta)",
    rulesEnableLabel: "Usar el asistente de reglas",
    rulesDesc: "Crea filtros de mensajes paso a paso, con explicaciones y una vista previa de qué correos de la bandeja de entrada coincidirían. Activado, el menú contextual de la lista de mensajes ofrece «Crear regla a partir de este correo …». Guarda un filtro normal de Betterbird (Herramientas → Filtros de mensajes) que funciona también sin NovaBird; los filtros existentes no cambian y antes se hace una copia del archivo de filtros.",
    rulesOpen: "Abrir el asistente de reglas",
    selfTest_rules: "Asistente de reglas (filtros de mensajes)",
    tabStats: "Buzón",
    statsTitle: "Análisis del buzón",
    statsRefresh: "Actualizar",
    statsUpdated: "Estado: $1",
    statsNote: "Calculado con los datos almacenados localmente; no se descarga nada. En cuentas IMAP sin almacenamiento sin conexión solo cuenta lo que está en local.",
    statsAccounts: "Cuentas",
    statsFolders: "Carpetas",
    statsMessages: "Mensajes",
    statsTotal: "Tamaño total",
    statsPerAccount: "Por cuenta",
    statsDistribution: "Distribución por tamaño",
    statsTop: "Carpetas más grandes",
    statsLoading: "Calculando …",
    statsError: "El análisis ha fallado.",
    statsEmpty: "No se encontraron cuentas.",
    statsFoldersN: "$1 carpetas",
    statsMessagesN: "$1 mensajes",
    selfTest_mailStats: "Análisis del buzón",
    tabAi: "IA",
    aiTitle: "Resumen con IA",
    aiDesc: "Resume un mensaje abierto con un modelo de lenguaje. Nada ocurre automáticamente: solo el botón «Resumir mensaje (IA)» de la vista del mensaje envía el texto a la dirección de abajo. Pensado para un modelo en su propio ordenador (Ollama) o un servicio compatible con OpenAI.",
    aiCtxLabel: "Longitud de contexto (tokens)",
    aiPromptTitle: "Instrucción para la IA",
    aiPromptDesc: "Este es el texto que el modelo recibe junto con el correo. Va antes del texto del correo y aquí no se puede cambiar. Marcadores de posición: {ZIEL} pasa a ser el idioma elegido, {OPEN} y {CLOSE} son marcadores con un identificador aleatorio entre los que va el texto del correo.",
    aiPromptSafe: ["Separación: el texto del correo va entre marcadores nuevos y aleatorios en cada solicitud. Un remitente no puede predecirlos y por tanto no puede salir de la parte de texto.", "Datos de terceros: se informa expresamente al modelo de que el texto procede de otros y de que no debe seguir las instrucciones que contenga. Esto hace menos probables las instrucciones inyectadas, pero con modelos de lenguaje no las descarta con seguridad.", "Efecto limitado: el modelo no tiene herramientas. No puede enviar, abrir ni borrar nada; su respuesta solo se muestra como texto. En el peor caso, un resumen es erróneo o engañoso.", "Aviso: si un correo contiene frases como «ignora todas las instrucciones», aparece una advertencia sobre el resumen."],
    aiEnabledLabel: "Usar el resumen con IA (el botón «Resumir mensaje (IA)» solo aparece si esto está activado)",
    aiTypeLabel: "Interfaz",
    aiUrlLabel: "Dirección",
    aiModelLabel: "Modelo",
    aiUserLabel: "Nombre de usuario (opcional)",
    aiKeyLabel: "Contraseña o clave API (opcional)",
    aiLangLabel: "Resumen en",
    aiLangUi: "Idioma de la interfaz",
    aiLangMail: "Idioma del mensaje",
    aiTest: "Probar conexión",
    aiTesting: "Comprobando …",
    aiOk: "Conectado: $1 modelos encontrados.",
    aiFail: "Error: $1",
    aiPerm: "No se concedió el permiso para esta dirección.",
    aiRemote: "Atención: esta dirección no está en este ordenador. Al resumir, el texto del mensaje se envía allí.",
    aiNote: "Las credenciales se guardan en los datos de perfil de este complemento (sin cifrar). Con nombre de usuario se usa autenticación Basic, si no la contraseña se envía como clave Bearer. Recomendado: Ollama con un modelo como gemma3:12b o qwen3.5:9b.",
    tabPilot: "Nova-Contact",
    pilotTitle: "Nova-Contact en la pestaña Contactos",
    pilotEnableLabel: "Usar Nova-Contact",
    pilotDesc: "Amplía la pestaña Contactos de Betterbird: filtrar por etiquetas, editar varios contactos a la vez (etiquetas, empresa, cargo) y deshacer los últimos 3 cambios. El botón «Nova-Contact» bajo la lista de libretas abre la página para recoger direcciones del correo, fusionar duplicados y limpiar contactos antiguos (con restauración).",
    pilotLogLabel: "Mostrar un registro en la página de Nova-Contact (acciones con hora, solo hasta reiniciar)",
    tabCalendar: "Panel derecho",
    tabColors: "Colores y fuente",
    layoutTitle: "Diseño del panel derecho",
    layoutNova: "Diseño NovaBird: eventos y tareas juntos en correo, calendario y tareas (predeterminado)",
    layoutDefault: "Predeterminado de Betterbird",
    agendaTitle: "Lista de eventos (panel derecho)",
    agendaLabel: "Días que mostrar (hoy y siguientes, 1 = solo hoy):",
    attachTitle: "Vista de correo – pestaña derecha",
    attachLabel: "Mostrar los adjuntos del mensaje o de toda la conversación bajo la agenda (divisor movible)",
    resetAttach: "Restablecer el divisor",
    calTab: "Pestaña Calendario",
    mailTab: "Pestaña Correo",
    diagTitle: "Diagnóstico",
    diagBtn: "Mostrar estado",
    colorTitle: "Custom Colors (colores personalizados)",
    modeTheme: "Usar los colores del tema",
    modeCustom: "Colores personalizados",
    bgLabel: "Fondo",
    fgLabel: "Texto",
    borderLabel: "Líneas y bordes",
    accentLabel: "Acento (selección, pestañas, resaltado)",
    reset: "Restablecer colores",
    cfEdit: "Editar para:",
    cfLight: "Claro",
    cfDark: "Oscuro",
    cfNote: "Claro y oscuro siguen el esquema de color del sistema. Solo se guardan los colores cambiados, los demás siguen el tema.",
    cfHint: "Pase el ratón sobre un color: el área afectada se marca en el esquema. El esquema muestra los colores del modo elegido.",
    cfNoTheme: "El tema activo no es un tema NovaBird. Los colores de la ventana principal (izquierda, arriba) solo funcionan con Sand, Cobalt o Springlight; los diálogos, la configuración y la ventana de redacción funcionan con cualquier tema.",
    g_areas: "Ventana principal: superficies",
    g_text: "Ventana principal: texto y líneas",
    g_accent: "Selección y acento",
    g_dialog: "Diálogos, configuración, redacción",
    c_spaces: "Barra de espacios",
    cd_spaces: "Barra estrecha de iconos a la izquierda (correo, calendario, libreta)",
    c_toolbar: "Barra de herramientas",
    cd_toolbar: "Barra superior con botones y campo de búsqueda",
    c_sidebar: "Panel de carpetas",
    cd_sidebar: "Fondo de la lista de carpetas",
    c_list: "Lista y vista de mensajes",
    cd_list: "Fondo donde se listan y leen los mensajes",
    c_text: "Texto",
    cd_text: "Asunto, remitente y texto principal",
    c_muted: "Texto secundario",
    cd_muted: "Fecha, vista previa, títulos de cuentas en el panel de carpetas",
    c_sidebarText: "Texto de carpetas",
    cd_sidebarText: "Nombres de las carpetas",
    c_border: "Borde",
    cd_border: "Líneas entre áreas y alrededor de campos",
    c_rowLine: "Separador de filas",
    cd_rowLine: "Línea fina entre dos mensajes",
    c_hover: "Ratón encima",
    cd_hover: "Fila o carpeta bajo el puntero",
    c_accent: "Acento",
    cd_accent: "Barra de selección, enlaces e iconos activos",
    c_accentDark: "Acento oscuro",
    cd_accentDark: "Texto de la carpeta seleccionada",
    c_accentSoft: "Selección",
    cd_accentSoft: "Fondo de la carpeta seleccionada",
    c_accentFocus: "Selección con foco",
    cd_accentFocus: "Mensaje seleccionado en la lista",
    c_count: "Contador de no leídos",
    cd_count: "Píldora con el número (a la izquierda el fondo, a la derecha el texto)",
    cd_dbg: "Diálogos de eventos, configuración, cuentas y ventana de redacción",
    cd_dfg: "Texto en estas ventanas",
    cd_dborder: "Líneas y bordes de campos",
    cd_daccent: "Interruptores, botones y selección",
    fontTitle: "Fuente",
    fontIntro: "100 % es el tamaño actual. Los valores en píxeles valen para el tamaño de fuente predeterminado de Thunderbird.",
    fontNew: "La ventana de redacción, la configuración y las cuentas aplican los cambios al abrirse de nuevo.",
    fontReset: "Restablecer fuente",
    fg_main: "Ventana principal (tema)",
    fg_compose: "Ventana de redacción",
    fg_other: "Otras páginas",
    famTheme: "Predeterminada del tema",
    famSystem: "Sistema",
    f_family: "Fuente",
    fd_family: "Todo el texto de la ventana principal: carpetas, lista, barras",
    f_row: "Altura de fila de carpetas",
    fd_row: "Altura de una carpeta en el panel",
    f_pad: "Espaciado de la lista",
    fd_pad: "Espacio alrededor del remitente y el asunto",
    f_compose: "Tamaño base",
    fd_compose: "Menús, campos y botones; al menos 13,3 px, crece con el tamaño de fuente de Thunderbird",
    f_subject: "Asunto",
    fd_subject: "Línea de asunto",
    f_labels: "Etiquetas y barra de comandos",
    fd_labels: "«Para», «Cc», adjuntos y la barra con «Enviar»",
    f_sample: "Texto de ejemplo de la barra de formato",
    fd_sample: "Vista previa de la fuente al desplegar la barra",
    f_settings: "Configuración y cuentas",
    fd_settings: "Menú y contenido de estas páginas",
    f_contact: "Nova-Contact",
    fd_contact: "Barra lateral y página de contactos",
    hint: "Los cambios se aplican de inmediato; las ventanas abiertas los toman la próxima vez que se abran.",
  },
};
const DEFAULTS = {
  attachPane: true,
  paneLayout: "nova",
  agendaDays: 5,
  colorMode: "theme",
  pilotEnabled: true,
  pilotLog: false,
  rulesEnabled: false,
  previewEnabled: true,
  previewDelay: 400,
  listStyle: "default",
  listPreview: true,
  listAvatars: true,
  listDensity: "airy",
  listAcct: "none",
  listScroll: true,
  listAcctColors: {},
  colors: { bg: "#EEF2F8", fg: "#1B2433", border: "#D2DAE6", accent: "#2F6BD8" },
  mainColors: { light: {}, dark: {} },
  fontFamily: "", fontRow: 100, fontPad: 100,
  fontCompose: 100, fontSubject: 100, fontLabels: 100, fontSample: 100,
  fontSettings: 100, fontContact: 100,
};

const forcedLang = new URLSearchParams(location.search).get("lang"); // nur zum Testen: options.html?lang=fr
const lang = (forcedLang || messenger.i18n.getUILanguage() || "en").slice(0, 2).toLowerCase();
const t = TEXTS[lang] || TEXTS.en;
document.documentElement.lang = TEXTS[lang] ? lang : "en";

// Hinweis, wenn Funktionen wegen fehlender Betterbird-Interna aus sind (Selbsttest, shared/selftest-ui.js)
nbShowSelfTest(document.getElementById("nb-selftest"), (key, subs) => (t[key] ?? TEXTS.en[key] ?? "").replace("$1", subs?.[0] ?? ""));
for (const [id, text] of Object.entries(t)) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text;
  }
}

// ---- Vorschaubilder (Miniaturen der rechten Leiste) ------------------------------------------
function rows(x, y, n, kind) {
  let out = "";
  for (let i = 0; i < n; i++) {
    const yy = y + i * 9;
    if (kind === "ev") {
      out += `<circle cx="${x + 3}" cy="${yy + 3}" r="2.2" class="acc"/>`;
    } else if (kind === "task") {
      out += `<rect x="${x}" y="${yy + 0.5}" width="5" height="5" rx="1" class="fr"/>`;
    } else {
      out += `<rect x="${x}" y="${yy}" width="10" height="6" rx="1.5" fill="${["#D93025", "#2B6CD8", "#1E8E3E"][i % 3]}"/>`;
    }
    out += `<rect x="${x + 13}" y="${yy + 1.5}" width="${26 + ((i * 11) % 15)}" height="3" rx="1.5" class="bar"/>`;
  }
  return out;
}

// blocks: Liste aus "ev" (Termine), "task" (Aufgaben), "att" (Anhänge); kind: "cal" oder "mail"
function paneSvg(blocks, kind, caption) {
  const X = 120;
  const W = 68;
  let o = `<rect x="1.5" y="1.5" width="197" height="117" rx="5" class="fr"/>`;
  o += `<rect x="1.5" y="1.5" width="14" height="117" rx="5" class="band"/>`;
  if (kind === "cal") {
    for (let i = 0; i < 5; i++) {
      o += `<line x1="${34 + i * 17}" y1="12" x2="${34 + i * 17}" y2="112" class="fr" stroke-opacity=".2"/>`;
    }
    o += `<rect x="52" y="48" width="16" height="22" rx="3" class="accl"/><rect x="86" y="30" width="16" height="16" rx="3" class="accl"/>`;
  } else {
    for (let i = 0; i < 8; i++) {
      o += `<rect x="22" y="${14 + i * 12}" width="${50 + ((i * 17) % 28)}" height="3" rx="1.5" class="bar"/>`;
    }
    o += `<rect x="22" y="${14 + 3 * 12 - 2}" width="90" height="8" rx="2" class="accl"/>`;
  }
  o += `<line x1="${X - 4}" y1="2" x2="${X - 4}" y2="118" class="fr"/>`;
  let y = 8;
  blocks.forEach((b, idx) => {
    if (idx > 0) {
      o += b === "att"
        ? `<line x1="${X - 4}" y1="${y - 1}" x2="198" y2="${y - 1}" class="solid"/>`
        : `<line x1="${X}" y1="${y - 1}" x2="196" y2="${y - 1}" class="dash"/>`;
    }
    const n = b === "ev" ? 3 : 2;
    o += `<rect x="${X - 3}" y="${y}" width="${W + 5}" height="7" class="band"/>`;
    o += `<rect x="${X}" y="${y + 2}" width="${b === "att" ? 22 : 16}" height="3" rx="1.5" class="bar" fill-opacity=".6"/>`;
    o += rows(X, y + 11, n, b);
    y += 11 + n * 9 + 5;
  });
  const text = String(caption).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  o += `<text x="100" y="132" text-anchor="middle" font-size="9.5" fill="currentColor" fill-opacity=".75" font-family="sans-serif">${text}</text>`;
  return `<svg viewBox="0 0 200 138" role="img" aria-label="${text}">${o}</svg>`;
}

function drawPreviews(s) {
  const nova = s.paneLayout !== "default";
  document.getElementById("layoutPreview").innerHTML = paneSvg(nova ? ["ev", "task"] : ["task"], "cal", t.calTab);
  const mail = nova ? ["ev", "task"] : ["ev"];
  if (s.attachPane !== false) {
    mail.push("att");
  }
  document.getElementById("attachPreview").innerHTML = paneSvg(mail, "mail", t.mailTab);
}

for (const b of document.querySelectorAll("nav button")) {
  b.addEventListener("click", () => {
    for (const o of document.querySelectorAll("nav button")) {
      o.setAttribute("aria-selected", String(o === b));
    }
    document.getElementById("calendar").hidden = b.dataset.tab !== "calendar";
    document.getElementById("colorsTab").hidden = b.dataset.tab !== "colors";
    document.getElementById("previewTab").hidden = b.dataset.tab !== "preview";
    document.getElementById("listTab").hidden = b.dataset.tab !== "list";
    document.getElementById("pilotTab").hidden = b.dataset.tab !== "pilot";
    document.getElementById("rulesTab").hidden = b.dataset.tab !== "rules";
    document.getElementById("statsTab").hidden = b.dataset.tab !== "stats";
    document.getElementById("aiTab").hidden = b.dataset.tab !== "ai";
    if (b.dataset.tab === "stats") {
      loadStats();
    }
  });
}
document.getElementById("tabList").setAttribute("aria-selected", "true");

// Skizzen der drei Stile der Nachrichtenliste
function listSvg(style) {
  let o = `<rect x="1.5" y="1.5" width="117" height="77" rx="5" class="fr"/>`;
  for (let i = 0; i < 3; i++) {
    const y = style === "clear" ? 8 + i * 15 : 7 + i * 24;
    if (style === "soft") {
      o += `<rect x="6" y="${y}" width="108" height="20" rx="5" class="fr"/><circle cx="17" cy="${y + 10}" r="5" class="${i === 0 ? "accl" : "band"}"/>`;
      o += `<rect x="27" y="${y + 3}" width="${40 + i * 6}" height="3.5" rx="1.7" class="bar"/><rect x="95" y="${y + 3}" width="12" height="3" rx="1.5" class="bar" fill-opacity=".18"/>`;
      o += `<rect x="27" y="${y + 9}" width="${60 - i * 8}" height="3" rx="1.5" class="bar" fill-opacity=".45"/><rect x="27" y="${y + 14}" width="${70 + i * 4}" height="2.5" rx="1.2" class="bar" fill-opacity=".18"/>`;
    } else if (style === "thread") {
      o += `<line x1="30" y1="${y - 4}" x2="30" y2="${y + 24}" class="fr" stroke-opacity=".5"/><circle cx="30" cy="${y + 8}" r="3" class="${i === 0 ? "acc" : "band"}"/>`;
      o += `<rect x="6" y="${y + 5}" width="14" height="3" rx="1.5" class="bar" fill-opacity=".3"/><rect x="6" y="${y + 11}" width="10" height="2.5" rx="1.2" class="bar" fill-opacity=".2"/>`;
      o += `<rect x="38" y="${y}" width="76" height="20" rx="5" class="fr"/><rect x="43" y="${y + 4}" width="${34 + i * 6}" height="3.5" rx="1.7" class="bar"/><rect x="43" y="${y + 11}" width="${54 - i * 6}" height="3" rx="1.5" class="bar" fill-opacity=".45"/>`;
    } else if (style === "clear") {
      o += `<line x1="2" y1="${y + 12}" x2="118" y2="${y + 12}" class="fr" stroke-opacity=".25"/>`;
      if (i === 0) o += `<rect x="2" y="${y}" width="2" height="12" class="acc"/>`;
      o += `<rect x="8" y="${y + 4}" width="26" height="3.5" rx="1.7" class="bar"/><rect x="40" y="${y + 4}" width="${34 - i * 4}" height="3.5" rx="1.7" class="bar" fill-opacity=".4"/><rect x="${78 - i * 4}" y="${y + 4.2}" width="24" height="3" rx="1.5" class="bar" fill-opacity=".18"/><rect x="104" y="${y + 4}" width="10" height="3" rx="1.5" class="bar" fill-opacity=".18"/>`;
    } else {
      o += `<rect x="6" y="${y}" width="108" height="20" rx="5" class="fr"/><rect x="11" y="${y + 4}" width="${36 + i * 6}" height="3.5" rx="1.7" class="bar"/><rect x="11" y="${y + 11}" width="${64 - i * 6}" height="3" rx="1.5" class="bar" fill-opacity=".45"/><rect x="92" y="${y + 4}" width="16" height="3" rx="1.5" class="bar" fill-opacity=".18"/>`;
    }
  }
  return `<svg viewBox="0 0 120 80" role="img" aria-label="${style}" style="width:120px">${o}</svg>`;
}

// Skizzen für Dichte und Kontofarbe
function denSvg(kind) {
  let o = `<rect x="1.5" y="1.5" width="117" height="77" rx="5" class="fr"/>`;
  const h = { airy: 24, normal: 17, compact: 9 }[kind], n = Math.floor(70 / h);
  for (let i = 0; i < n; i++) {
    const y = 6 + i * h;
    if (kind === "compact") {
      o += `<line x1="2" y1="${y + h}" x2="118" y2="${y + h}" class="fr" stroke-opacity=".25"/><rect x="8" y="${y + 3}" width="22" height="3" rx="1.5" class="bar"/><rect x="36" y="${y + 3}" width="${40 - (i % 3) * 6}" height="3" rx="1.5" class="bar" fill-opacity=".4"/><rect x="100" y="${y + 3}" width="12" height="3" rx="1.5" class="bar" fill-opacity=".18"/>`;
    } else {
      o += `<rect x="6" y="${y}" width="108" height="${h - 3}" rx="4" class="fr"/>`;
      if (kind === "airy") o += `<circle cx="17" cy="${y + 10}" r="5" class="band"/>`;
      const x = kind === "airy" ? 27 : 12;
      o += `<rect x="${x}" y="${y + 4}" width="${40 + (i % 3) * 6}" height="3.5" rx="1.7" class="bar"/><rect x="${x}" y="${y + 10}" width="${56 - (i % 3) * 8}" height="3" rx="1.5" class="bar" fill-opacity=".45"/>`;
      if (kind === "airy") o += `<rect x="${x}" y="${y + 15}" width="${66 + (i % 3) * 4}" height="2.5" rx="1.2" class="bar" fill-opacity=".18"/>`;
    }
  }
  return `<svg viewBox="0 0 120 80" role="img" aria-label="${kind}" style="width:120px">${o}</svg>`;
}
const ACCT_COLORS = ["#378ADD", "#1D9E75", "#D85A30"];
function acctSvg(kind) {
  let o = `<rect x="1.5" y="1.5" width="117" height="47" rx="5" class="fr"/>`;
  for (let i = 0; i < 3; i++) {
    const y = 5 + i * 14, c = ACCT_COLORS[i];
    o += `<rect x="6" y="${y}" width="108" height="12" rx="3" class="fr" stroke-opacity=".25"/>`;
    if (kind === "bar") o += `<rect x="6" y="${y}" width="3" height="12" fill="${c}"/>`;
    if (kind === "ring") o += `<circle cx="16" cy="${y + 6}" r="4" fill="none" stroke="${c}" stroke-width="1.8"/>`;
    if (kind === "dot") o += `<circle cx="14" cy="${y + 6}" r="2.6" fill="${c}"/><rect x="19" y="${y + 4.5}" width="14" height="3" rx="1.5" class="bar" fill-opacity=".3"/>`;
    const x = kind === "dot" ? 38 : 24;
    o += `<rect x="${x}" y="${y + 4.5}" width="${46 - i * 6}" height="3" rx="1.5" class="bar"/><rect x="98" y="${y + 4.5}" width="10" height="3" rx="1.5" class="bar" fill-opacity=".18"/>`;
  }
  return `<svg viewBox="0 0 120 52" role="img" aria-label="${kind}" style="width:120px">${o}</svg>`;
}

const save = patch => messenger.storage.local.set(patch);

(async () => {
  const s = await messenger.storage.local.get(DEFAULTS);
  const fieldset = document.getElementById("colors");
  const syncDisabled = mode => { fieldset.disabled = mode !== "custom"; };
  drawPreviews(s);

  for (const radio of document.querySelectorAll("input[name=colorMode]")) {
    radio.checked = radio.value === s.colorMode;
    radio.addEventListener("change", () => {
      syncDisabled(radio.value);
      save({ colorMode: radio.value });
    });
  }
  syncDisabled(s.colorMode);
  document.getElementById("diagBtn").addEventListener("click", async () => {
    document.getElementById("diagOut").textContent = await messenger.runtime.sendMessage({ type: "status" });
  });
  document.getElementById("resetAttach").addEventListener("click", () => save({ resetTick: Date.now() }));
  for (const radio of document.querySelectorAll("input[name=paneLayout]")) {
    radio.checked = radio.value === (s.paneLayout === "default" ? "default" : "nova");
    radio.addEventListener("change", () => {
      s.paneLayout = radio.value;
      drawPreviews(s);
      save({ paneLayout: radio.value });
    });
  }
  const ad = document.getElementById("agendaDays");
  ad.value = s.agendaDays;
  ad.addEventListener("change", () => {
    const n = Math.min(28, Math.max(1, Math.round(Number(ad.value)) || 5));
    ad.value = n;
    save({ agendaDays: n });
  });
  const ap = document.getElementById("attachPane");
  ap.checked = s.attachPane !== false;
  ap.addEventListener("change", () => {
    s.attachPane = ap.checked;
    drawPreviews(s);
    save({ attachPane: ap.checked });
  });

  const lp = document.getElementById("listPreview"), la = document.getElementById("listAvatars");
  // „Ausgegraut“ ohne disabled: deaktivierte Eingaben sind in der eingebetteten Seite (dunkles/helles Schema) unsichtbar
  const dim = (input, off) => {
    input.closest("label").classList.toggle("off", off);
    input.dataset.off = off ? "1" : "";
    input.tabIndex = off ? -1 : 0;
  };
  const syncList = () => {
    const soft = s.listStyle === "soft", compact = s.listDensity === "compact", plain = s.listStyle === "default" || !s.listStyle;
    dim(la, plain || !soft || compact);
    dim(lp, plain || compact);
    for (const r of document.querySelectorAll("input[name=listDensity]")) dim(r, plain);
    for (const r of document.querySelectorAll("input[name=listAcct]")) {
      dim(r, plain || (r.value === "dot" && compact) || (r.value === "ring" && (!soft || compact || !la.checked)));
    }
  };
  const revert = () => {
    for (const r of document.querySelectorAll("input[name=listDensity]")) r.checked = r.value === (["normal", "compact"].includes(s.listDensity) ? s.listDensity : "airy");
    for (const r of document.querySelectorAll("input[name=listAcct]")) r.checked = r.value === (["bar", "ring", "dot"].includes(s.listAcct) ? s.listAcct : "none");
    la.checked = s.listAvatars !== false; lp.checked = s.listPreview !== false;
  };
  for (const radio of document.querySelectorAll("input[name=listDensity]")) {
    radio.checked = radio.value === (["normal", "compact"].includes(s.listDensity) ? s.listDensity : "airy");
    document.getElementById("sd_" + radio.value).innerHTML = denSvg(radio.value);
    radio.addEventListener("change", () => { if (radio.dataset.off) return revert(); s.listDensity = radio.value; syncList(); save({ listDensity: radio.value }); });
  }
  for (const radio of document.querySelectorAll("input[name=listAcct]")) {
    radio.checked = radio.value === (["bar", "ring", "dot"].includes(s.listAcct) ? s.listAcct : "none");
    document.getElementById("sa_" + radio.value).innerHTML = acctSvg(radio.value);
    radio.addEventListener("change", () => { if (radio.dataset.off) return revert(); s.listAcct = radio.value; save({ listAcct: radio.value }); });
  }
  // Farbe je Konto: gespeicherte Wahl, sonst Palette nach Reihenfolge (wie background.js)
  const PALETTE = ["#378ADD", "#1D9E75", "#D85A30", "#7F77DD", "#BA7517", "#D4537E", "#0F6E56", "#888780"];
  try {
    const box = document.getElementById("acctColors");
    const stored = { ...(s.listAcctColors || {}) };
    (await messenger.accounts.list(false)).forEach((a, i) => {
      const row = document.createElement("div");
      row.className = "color";
      const input = document.createElement("input");
      input.type = "color";
      input.value = stored[a.id] || PALETTE[i % PALETTE.length];
      const name = document.createElement("span");
      name.textContent = a.name;
      row.append(input, name);
      input.addEventListener("input", () => { stored[a.id] = input.value; save({ listAcctColors: { ...stored } }); });
      box.append(row);
    });
  } catch (e) { /* ohne Kontoliste */ }
  for (const radio of document.querySelectorAll("input[name=listStyle]")) {
    radio.checked = radio.value === (["soft", "clear", "thread"].includes(s.listStyle) ? s.listStyle : "default");
    document.getElementById("sk_" + radio.value).innerHTML = listSvg(radio.value);
    radio.addEventListener("change", () => { s.listStyle = radio.value; syncList(); save({ listStyle: radio.value }); });
  }
  lp.checked = s.listPreview !== false;
  la.checked = s.listAvatars !== false;
  syncList();
  const ls = document.getElementById("listScroll");
  ls.checked = s.listScroll !== false;
  ls.addEventListener("change", () => save({ listScroll: ls.checked }));
  lp.addEventListener("change", () => { if (lp.dataset.off) return revert(); save({ listPreview: lp.checked }); });
  la.addEventListener("change", () => { if (la.dataset.off) return revert(); syncList(); save({ listAvatars: la.checked }); });

  const ve = document.getElementById("previewEnabled"), vd = document.getElementById("previewDelay");
  ve.checked = s.previewEnabled !== false;
  vd.value = String(s.previewDelay);
  if (vd.value !== String(s.previewDelay)) vd.value = "400";
  vd.disabled = !ve.checked;
  ve.addEventListener("change", () => { vd.disabled = !ve.checked; save({ previewEnabled: ve.checked }); });
  vd.addEventListener("change", () => save({ previewDelay: Number(vd.value) }));

  const pe = document.getElementById("pilotEnabled"), pl = document.getElementById("pilotLog");
  pe.checked = s.pilotEnabled !== false;
  pl.checked = !!s.pilotLog;
  pl.disabled = !pe.checked;
  pe.addEventListener("change", () => { pl.disabled = !pe.checked; save({ pilotEnabled: pe.checked }); });
  pl.addEventListener("change", () => save({ pilotLog: pl.checked }));
  // Regel-Assistent (Beta, Opt-in)
  const re = document.getElementById("rulesEnabled"), ro = document.getElementById("rulesOpen");
  re.checked = s.rulesEnabled === true;
  ro.disabled = !re.checked;
  re.addEventListener("change", () => { ro.disabled = !re.checked; save({ rulesEnabled: re.checked }); });
  ro.addEventListener("click", () => messenger.runtime.sendMessage({ type: "openRules" }));
})(); // Farben und Schrift: looks.js

// ---- Postfachanalyse ---------------------------------------------------------------------------
const STATS_PALETTE = ["#378ADD", "#1D9E75", "#D85A30", "#7F77DD", "#BA7517", "#D4537E", "#0F6E56", "#888780"];

function fmtNum(n) {
  return n.toLocaleString(document.documentElement.lang);
}

function fmtSize(bytes) {
  const mb = bytes / 1048576;
  if (mb >= 1024) {
    return (mb / 1024).toLocaleString(document.documentElement.lang, { maximumFractionDigits: 1 }) + " GB";
  }
  return mb.toLocaleString(document.documentElement.lang, { maximumFractionDigits: mb >= 100 ? 0 : 1 }) + " MB";
}

function statsEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) {
    e.className = cls;
  }
  if (text !== undefined) {
    e.textContent = text;
  }
  return e;
}

function statsBar(parts, big) {
  const bar = statsEl("div", "st-bar" + (big ? " big" : ""));
  for (const [share, color] of parts) {
    const seg = document.createElement("div");
    seg.style.width = Math.max(0, Math.min(100, share)) + "%";
    seg.style.background = color;
    bar.append(seg);
  }
  return bar;
}

let statsBusy = false;
async function loadStats() {
  if (statsBusy) {
    return;
  }
  statsBusy = true;
  const body = document.getElementById("statsBody");
  document.getElementById("statsUpdated").textContent = "";
  body.replaceChildren(statsEl("p", "st-sub", t.statsLoading));
  try {
    const accounts = await messenger.mailStats.getStats();
    const stored = (await messenger.storage.local.get({ listAcctColors: {} })).listAcctColors || {};
    let order = [];
    try {
      order = (await messenger.accounts.list(false)).map(a => a.id);
    } catch (e) { /* ohne Kontoreihenfolge */ }
    const colorOf = a => {
      const i = order.indexOf(a.id);
      return stored[a.id] || STATS_PALETTE[(i < 0 ? accounts.indexOf(a) : i) % STATS_PALETTE.length];
    };
    const rows = accounts.map(a => ({
      a,
      color: colorOf(a),
      folders: a.folders.length,
      messages: a.folders.reduce((n, f) => n + f.count, 0),
      size: a.folders.reduce((n, f) => n + f.size, 0),
    }));
    rows.sort((x, y) => y.size - x.size);
    const total = { folders: 0, messages: 0, size: 0 };
    for (const r of rows) {
      total.folders += r.folders;
      total.messages += r.messages;
      total.size += r.size;
    }
    body.replaceChildren();
    if (!rows.length) {
      body.append(statsEl("p", "st-sub", t.statsEmpty));
      return;
    }

    const kpis = statsEl("div", "st-kpis");
    for (const [label, value] of [[t.statsAccounts, fmtNum(rows.length)], [t.statsFolders, fmtNum(total.folders)], [t.statsMessages, fmtNum(total.messages)], [t.statsTotal, fmtSize(total.size)]]) {
      const k = statsEl("div", "st-kpi");
      k.append(statsEl("span", "", label), statsEl("b", "", value));
      kpis.append(k);
    }
    body.append(kpis);

    body.append(statsEl("h4", "st-h", t.statsPerAccount));
    for (const r of rows) {
      const card = statsEl("div", "st-acc");
      const head = statsEl("div", "st-ah");
      const dot = statsEl("span", "st-dot");
      dot.style.background = r.color;
      const meta = statsEl("span", "st-am");
      meta.append(
        statsEl("span", "", t.statsFoldersN.replace("$1", fmtNum(r.folders))),
        statsEl("span", "", t.statsMessagesN.replace("$1", fmtNum(r.messages))),
        statsEl("b", "", fmtSize(r.size))
      );
      head.append(dot, statsEl("b", "", r.a.name), meta);
      card.append(head, statsBar([[total.size ? (r.size / total.size) * 100 : 0, r.color]]));
      body.append(card);
    }

    if (rows.length > 1 && total.size) {
      body.append(statsEl("h4", "st-h", t.statsDistribution));
      body.append(statsBar(rows.map(r => [(r.size / total.size) * 100, r.color]), true));
    }

    const top = [];
    for (const r of rows) {
      for (const f of r.a.folders) {
        top.push({ f, color: r.color, account: r.a.name });
      }
    }
    top.sort((x, y) => y.f.size - x.f.size);
    const shown = top.filter(x => x.f.size > 0).slice(0, 8);
    if (shown.length) {
      body.append(statsEl("h4", "st-h", t.statsTop));
      const max = shown[0].f.size;
      for (const x of shown) {
        const row = statsEl("div", "st-top");
        const label = statsEl("span", "", x.f.path);
        label.title = x.account + " · " + x.f.path;
        label.style.overflow = "hidden";
        label.style.textOverflow = "ellipsis";
        label.style.whiteSpace = "nowrap";
        row.append(label, statsBar([[(x.f.size / max) * 100, x.color]]), statsEl("span", "sz", fmtSize(x.f.size)));
        body.append(row);
      }
    }
    document.getElementById("statsUpdated").textContent = t.statsUpdated.replace("$1", new Date().toLocaleString(document.documentElement.lang));
  } catch (e) {
    console.error(e);
    body.replaceChildren(statsEl("p", "st-sub", t.statsError));
  } finally {
    statsBusy = false;
  }
}
document.getElementById("statsRefresh").addEventListener("click", loadStats);

// ---- KI-Zusammenfassung ---------------------------------------------------------------------------
(async () => {
  const ids = ["aiType", "aiUrl", "aiModel", "aiUser", "aiKey", "aiLang", "aiCtx"];
  const enabled = document.getElementById("aiEnabled");
  const body = document.getElementById("aiBody");
  const conf = { ...nbAI.DEFAULTS, ...(await messenger.storage.local.get(nbAI.DEFAULTS)) };
  const status = document.getElementById("aiStatus");
  const langSel = document.getElementById("aiLang");
  langSel.options[0].textContent = t.aiLangUi;
  langSel.options[1].textContent = t.aiLangMail;
  for (const id of ids) {
    document.getElementById(id).value = String(conf[id]);
  }
  const current = () => Object.fromEntries(ids.map(id => [id, id === "aiCtx" ? Number(document.getElementById(id).value) : document.getElementById(id).value.trim()]));
  const syncRemote = () => {
    const url = current().aiUrl;
    let remote = false;
    try {
      remote = /^https?:/i.test(url) && !nbAI.isLocal(url);
    } catch (e) { /* ungültige Adresse */ }
    const box = document.getElementById("aiRemote");
    box.hidden = !remote;
    box.textContent = t.aiRemote;
  };
  syncRemote();
  enabled.checked = conf.aiEnabled === true;
  body.classList.toggle("off", !enabled.checked);
  enabled.addEventListener("change", () => {
    body.classList.toggle("off", !enabled.checked);
    save({ aiEnabled: enabled.checked });
  });
  // Anweisung an die KI anzeigen und erklären (Text aus ai/ai.js, in der Sprache der Oberfläche)
  document.getElementById("aiPromptText").textContent = nbAI.promptTemplate(document.documentElement.lang, false);
  const safeList = document.getElementById("aiPromptList");
  for (const line of t.aiPromptSafe) {
    safeList.append(Object.assign(document.createElement("li"), { textContent: line }));
  }
  for (const id of ids) {
    document.getElementById(id).addEventListener("change", async () => {
      await save(current());
      syncRemote();
    });
  }
  document.getElementById("aiUrl").addEventListener("input", syncRemote);
  document.getElementById("aiTest").addEventListener("click", async () => {
    const c = current();
    status.textContent = t.aiTesting;
    try {
      await save(c);
      // Erlaubnis für Adressen außerhalb des eigenen Rechners (muss aus einem Klick heraus erfragt werden)
      if (/^https?:/i.test(c.aiUrl) && !nbAI.isLocal(c.aiUrl)) {
        const ok = await messenger.permissions.request({ origins: [nbAI.origin(c.aiUrl)] });
        if (!ok) {
          status.textContent = t.aiFail.replace("$1", t.aiPerm);
          return;
        }
      }
      const models = await nbAI.listModels(c);
      const list = document.getElementById("aiModels");
      list.replaceChildren(...models.map(m => Object.assign(document.createElement("option"), { value: m })));
      status.textContent = t.aiOk.replace("$1", String(models.length));
    } catch (e) {
      status.textContent = t.aiFail.replace("$1", String(e.message || e));
    }
  });
})();
