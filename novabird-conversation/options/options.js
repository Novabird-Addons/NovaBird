"use strict";

const api = typeof messenger !== "undefined" ? messenger : browser;

for (const node of document.querySelectorAll("[data-i18n]")) {
  node.textContent = api.i18n.getMessage(node.dataset.i18n);
}
document.title = api.i18n.getMessage("optTitle");

// Hinweis, wenn Funktionen wegen fehlender Betterbird-Interna aus sind (Selbsttest, shared/selftest-ui.js)
nbShowSelfTest(document.getElementById("nb-selftest"), (key, subs) => api.i18n.getMessage(key, subs));

// „Thunderbird Conversations“ ebenfalls aktiv: Hinweis mit Auswahl (deaktivieren nur auf Klick)
(async () => {
  const box = document.getElementById("nbc-other");
  try {
    const other = await api.conversationView.getOtherConversations();
    if (!other?.active) return;
    box.hidden = false;
    document.getElementById("nbc-other-later").addEventListener("click", () => { box.hidden = true; });
    document.getElementById("nbc-other-off").addEventListener("click", async () => {
      const done = await api.conversationView.disableOtherConversations().catch(() => false);
      if (!done) return;
      document.getElementById("nbc-other-text").textContent = api.i18n.getMessage("otherConvDone");
      for (const b of box.querySelectorAll("button")) b.hidden = true;
    });
  } catch (e) {
    // Experiment in eingebetteter Seite nicht erreichbar: kein Hinweis
  }
})();

const FIELDS = ["engine", "limit", "order", "pin", "maxHeight", "expand", "attachments", "collapseQuotes", "rowLines", "autoOriginal", "stickyHeader", "autoOpen", "autoOpenTrigger", "autoOpenDwell", "autoOpenDelay", "openMs", "fadeMs", "fallback", "fallbackDays", "fallbackPeople", "hideHeader", "debugTiming", "alwaysRender"];
const field = id => document.getElementById(id);
let hideTimer;

function apply(settings) {
  for (const radio of document.querySelectorAll('input[name="style"]')) radio.checked = radio.value === settings.style;
  for (const id of FIELDS) {
    const input = field(id);
    if (input.type === "checkbox") input.checked = settings[id];
    else input.value = settings[id];
  }
  field("pin").disabled = settings.order !== "newest";
  field("autoOpenDelay").disabled = !settings.autoOpenDwell;
  field("fallbackDays").disabled = field("fallbackPeople").disabled = settings.fallback !== "smart";
}

function read() {
  const raw = {};
  for (const id of FIELDS) {
    const input = field(id);
    raw[id] = input.type === "checkbox" ? input.checked : input.type === "number" || id === "limit" ? Number(input.value) : input.value;
  }
  raw.style = document.querySelector('input[name="style"]:checked')?.value;
  return sanitizeSettings(raw);
}

async function save() {
  const settings = read();
  await api.storage.local.set({ settings });
  apply(settings);
  field("saved").style.visibility = "visible";
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { field("saved").style.visibility = "hidden"; }, 1500);
}

api.storage.local.get("settings").then(({ settings }) => {
  apply(sanitizeSettings(settings));
  for (const id of FIELDS) field(id).addEventListener("change", save);
  for (const radio of document.querySelectorAll('input[name="style"]')) radio.addEventListener("change", save);
});

// Reiter
function showTab(name) {
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    const on = tab.id === `tab-${name}`;
    tab.setAttribute("aria-selected", String(on));
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !on;
  }
  try { sessionStorage.setItem("nbcTab", name); } catch (e) { /* ohne Speicher weiter */ }
}
for (const tab of document.querySelectorAll('[role="tab"]')) tab.addEventListener("click", () => showTab(tab.id.slice(4)));
let startTab = "settings";
try { startTab = sessionStorage.getItem("nbcTab") || "settings"; } catch (e) { /* ohne Speicher weiter */ }
showTab(startTab === "look" ? "look" : "settings");
