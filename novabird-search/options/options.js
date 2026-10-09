"use strict";

for (const el of document.querySelectorAll("[data-i18n]")) {
  el.textContent = messenger.i18n.getMessage(el.dataset.i18n);
}
document.getElementById("version").textContent = messenger.runtime.getManifest().version;

const fields = Object.keys(SETTINGS_DEFAULTS);
const saved = document.getElementById("saved");
let hideTimer = null;

function readForm() {
  const raw = {};
  for (const key of fields) {
    const input = document.getElementById(key);
    raw[key] = input.type === "checkbox" ? input.checked : input.value;
  }
  return sanitizeSettings(raw);
}

// Höchstzahl: feste Auswahl oder „manuell“ mit Zahlenfeld
const limitSel = document.getElementById("glodaLimitSel");
const limitInput = document.getElementById("glodaLimit");
function syncLimitSelect() {
  const v = limitInput.value;
  limitSel.value = [...limitSel.options].some(o => o.value === v && o.value !== "custom") ? v : "custom";
  limitInput.hidden = limitSel.value !== "custom";
}
limitSel.addEventListener("change", () => {
  if (limitSel.value !== "custom") {
    limitInput.value = limitSel.value;
  }
  limitInput.hidden = limitSel.value !== "custom";
  updateLimitWarn();
  if (limitSel.value !== "custom") save();
});
limitInput.addEventListener("input", updateLimitWarn);

function writeForm(settings) {
  for (const key of fields) {
    const input = document.getElementById(key);
    if (input.type === "checkbox") {
      input.checked = settings[key];
    } else {
      input.value = settings[key];
    }
  }
  syncLimitSelect();
  updateLimitWarn();
}

// Hinweis zur Höchstzahl: rot hervorheben, sobald mehr als 10.000 Treffer (oder unbegrenzt) gewählt sind
function updateLimitWarn() {
  const v = Number(limitInput.value);
  document.getElementById("limitWarn").style.color = v === 0 || v > 10000 ? "#b3261e" : "";
}

async function save() {
  await messenger.storage.local.set({ [SETTINGS_KEY]: readForm() });
  saved.style.visibility = "visible";
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => (saved.style.visibility = "hidden"), 1200);
}

messenger.storage.local.get(SETTINGS_KEY).then(stored => {
  writeForm(sanitizeSettings(stored[SETTINGS_KEY]));
  for (const key of fields) {
    document.getElementById(key).addEventListener("change", save);
  }
});

// Status des NovaBird-DB anzeigen (Ping an das andere Add-on)
async function showDbState() {
  const el = document.getElementById("dbState");
  const t = (key, subs) => messenger.i18n.getMessage(key, subs);
  if (readForm().novabirdDb === "off") {
    el.textContent = t("optDbStateOff");
    return;
  }
  let st = null;
  try {
    st = await Promise.race([
      messenger.runtime.sendMessage("novabird-db@novabird", { type: "ping" }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 4000)),
    ]);
  } catch {
    st = null;
  }
  if (!st?.ok) el.textContent = t("optDbStateMissing");
  else if (st.indexing) el.textContent = t("optDbStateIndexing", [String(st.messages)]);
  else if (!st.messages) el.textContent = t("optDbStateEmpty");
  else if (!st.usable) el.textContent = t("optDbStateNotReady");
  else el.textContent = t("optDbStateReady", [String(st.messages), st.version]);
}
messenger.storage.local.get(SETTINGS_KEY).then(() => {
  showDbState();
  document.getElementById("novabirdDb").addEventListener("change", showDbState);
});
