"use strict";

// Texte: Deutsch, Englisch, Französisch, Spanisch (Sprache der Betterbird-Oberfläche, sonst Englisch)
const TEXTS = {
  de: {
    title: "NovaBird-Extension",
    tabPreview: "Anhang-Vorschau",
    previewTitle: "Vorschau von PDF- und Bild-Anhängen",
    previewEnableLabel: "Vorschau beim Überfahren anzeigen",
    previewDesc: "Zeigt beim Überfahren eines Anhangs mit der Maus – in der Anhangsliste der Mail, im Anhänge-Bereich der rechten Leiste und (falls installiert) in der Konversationsansicht – das PDF oder Bild in einem scrollbaren Fenster neben dem Anhang. „Öffnen“ im Fenster öffnet den Anhang in einem eigenen Tab. Es wird nichts heruntergeladen oder verändert.",
    previewDelayLabel: "Verzögerung bis zur Vorschau:",
    tabPilot: "Nova-Contact",
    pilotTitle: "Nova-Contact im Kontakte-Tab",
    pilotEnableLabel: "Nova-Contact verwenden",
    pilotDesc: "Ergänzt den Kontakte-Tab von Betterbird: Tags als Filter, mehrere Kontakte gemeinsam bearbeiten (Tags, Firma, Position) und die letzten 3 Änderungen rückgängig machen. Der Knopf „Nova-Contact“ unter der Adressbuchliste öffnet die Seite zum Sammeln von Adressen aus E-Mails, zum Zusammenführen von Dubletten und zum Aufräumen alter Kontakte (mit Wiederherstellung).",
    pilotLogLabel: "Protokoll in der Nova-Contact-Seite anzeigen (Aktionen mit Uhrzeit, nur bis zum Neustart gespeichert)",
    tabCalendar: "Rechte Leiste",
    tabColors: "Farben",
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
    colorTitle: "Farben von Dialogen, Einstellungen und Verfassen-Fenster",
    modeTheme: "Farben des Themes übernehmen",
    modeCustom: "Eigene Farben",
    bgLabel: "Hintergrund",
    fgLabel: "Schrift",
    borderLabel: "Linien und Rahmen",
    accentLabel: "Akzent (Auswahl, Reiter, Hervorhebung)",
    reset: "Zurücksetzen",
    hint: "Änderungen wirken sofort; offene Fenster übernehmen sie beim nächsten Öffnen.",
  },
  en: {
    title: "NovaBird-Extension",
    tabPreview: "Attachment preview",
    previewTitle: "Preview of PDF and image attachments",
    previewEnableLabel: "Show preview on hover",
    previewDesc: "When you hover an attachment – in the message’s attachment list, in the right-hand attachments area and (if installed) in the conversation view – the PDF or image appears in a scrollable window next to it. “Open” in the window opens the attachment in its own tab. Nothing is downloaded or changed.",
    previewDelayLabel: "Delay before the preview:",
    tabPilot: "Nova-Contact",
    pilotTitle: "Nova-Contact in the Contacts tab",
    pilotEnableLabel: "Use Nova-Contact",
    pilotDesc: "Extends Betterbird’s Contacts tab: filter by tags, edit several contacts at once (tags, company, job title) and undo the last 3 changes. The “Nova-Contact” button below the address book list opens the page for collecting addresses from email, merging duplicates and cleaning up old contacts (with restore).",
    pilotLogLabel: "Show a log on the Nova-Contact page (actions with time, kept only until restart)",
    tabCalendar: "Right pane",
    tabColors: "Colors",
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
    colorTitle: "Colors of dialogs, settings and compose window",
    modeTheme: "Use the theme's colors",
    modeCustom: "Custom colors",
    bgLabel: "Background",
    fgLabel: "Text",
    borderLabel: "Lines and borders",
    accentLabel: "Accent (selection, tabs, highlight)",
    reset: "Reset",
    hint: "Changes apply immediately; open windows pick them up the next time they open.",
  },
  fr: {
    title: "NovaBird-Extension",
    tabPreview: "Aperçu des pièces jointes",
    previewTitle: "Aperçu des pièces jointes PDF et images",
    previewEnableLabel: "Afficher l’aperçu au survol",
    previewDesc: "Au survol d’une pièce jointe – dans la liste des pièces jointes du message, dans la zone des pièces jointes à droite et (si installée) dans la vue des conversations – le PDF ou l’image s’affiche dans une fenêtre défilante à côté. « Ouvrir » ouvre la pièce jointe dans un onglet. Rien n’est téléchargé ni modifié.",
    previewDelayLabel: "Délai avant l’aperçu :",
    tabPilot: "Nova-Contact",
    pilotTitle: "Nova-Contact dans l’onglet Contacts",
    pilotEnableLabel: "Utiliser Nova-Contact",
    pilotDesc: "Complète l’onglet Contacts de Betterbird : filtrer par tags, modifier plusieurs contacts à la fois (tags, société, fonction) et annuler les 3 dernières modifications. Le bouton « Nova-Contact » sous la liste des carnets ouvre la page pour collecter des adresses depuis les e-mails, fusionner les doublons et nettoyer les anciens contacts (avec restauration).",
    pilotLogLabel: "Afficher un journal sur la page Nova-Contact (actions avec l’heure, conservé jusqu’au redémarrage)",
    tabCalendar: "Panneau de droite",
    tabColors: "Couleurs",
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
    colorTitle: "Couleurs des boîtes de dialogue, des paramètres et de la fenêtre de rédaction",
    modeTheme: "Utiliser les couleurs du thème",
    modeCustom: "Couleurs personnalisées",
    bgLabel: "Arrière-plan",
    fgLabel: "Texte",
    borderLabel: "Lignes et bordures",
    accentLabel: "Accent (sélection, onglets, surbrillance)",
    reset: "Réinitialiser",
    hint: "Les modifications s'appliquent immédiatement ; les fenêtres ouvertes les prennent en compte à la prochaine ouverture.",
  },
  es: {
    title: "NovaBird-Extension",
    tabPreview: "Vista previa de adjuntos",
    previewTitle: "Vista previa de adjuntos PDF e imágenes",
    previewEnableLabel: "Mostrar vista previa al pasar el ratón",
    previewDesc: "Al pasar el ratón sobre un adjunto – en la lista de adjuntos del mensaje, en el área de adjuntos de la derecha y (si está instalado) en la vista de conversaciones – el PDF o la imagen aparece en una ventana desplazable junto a él. «Abrir» abre el adjunto en una pestaña propia. No se descarga ni se modifica nada.",
    previewDelayLabel: "Retraso antes de la vista previa:",
    tabPilot: "Nova-Contact",
    pilotTitle: "Nova-Contact en la pestaña Contactos",
    pilotEnableLabel: "Usar Nova-Contact",
    pilotDesc: "Amplía la pestaña Contactos de Betterbird: filtrar por etiquetas, editar varios contactos a la vez (etiquetas, empresa, cargo) y deshacer los últimos 3 cambios. El botón «Nova-Contact» bajo la lista de libretas abre la página para recoger direcciones del correo, fusionar duplicados y limpiar contactos antiguos (con restauración).",
    pilotLogLabel: "Mostrar un registro en la página de Nova-Contact (acciones con hora, solo hasta reiniciar)",
    tabCalendar: "Panel derecho",
    tabColors: "Colores",
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
    colorTitle: "Colores de los diálogos, la configuración y la ventana de redacción",
    modeTheme: "Usar los colores del tema",
    modeCustom: "Colores personalizados",
    bgLabel: "Fondo",
    fgLabel: "Texto",
    borderLabel: "Líneas y bordes",
    accentLabel: "Acento (selección, pestañas, resaltado)",
    reset: "Restablecer",
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
  previewEnabled: true,
  previewDelay: 400,
  colors: { bg: "#EEF2F8", fg: "#1B2433", border: "#D2DAE6", accent: "#2F6BD8" },
};
const KEYS = ["bg", "fg", "border", "accent"];

const forcedLang = new URLSearchParams(location.search).get("lang"); // nur zum Testen: options.html?lang=fr
const lang = (forcedLang || messenger.i18n.getUILanguage() || "en").slice(0, 2).toLowerCase();
const t = TEXTS[lang] || TEXTS.en;
document.documentElement.lang = TEXTS[lang] ? lang : "en";
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
    document.getElementById("pilotTab").hidden = b.dataset.tab !== "pilot";
  });
}
document.getElementById("tabCalendar").setAttribute("aria-selected", "true");

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

  const colors = { ...DEFAULTS.colors, ...s.colors };
  for (const key of KEYS) {
    const input = document.getElementById(key);
    input.value = colors[key];
    input.addEventListener("input", () => {
      colors[key] = input.value;
      save({ colors: { ...colors } }); // sofort speichern: Live-Vorschau beim Ziehen im Farbwähler
    });
  }
  document.getElementById("reset").addEventListener("click", () => {
    for (const key of KEYS) {
      colors[key] = DEFAULTS.colors[key];
      document.getElementById(key).value = colors[key];
    }
    save({ colors: { ...colors } });
  });
})();
