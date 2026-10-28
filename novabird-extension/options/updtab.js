"use strict";

/* Reiter „Online-Updates“: Schalter, Kanal, Verhalten, Liste der acht Pakete mit installierter und verfügbarer Version.
 * Benötigt aus options.js: t, save; aus ../updates/updates.js: nbUpdates. Ausgeschaltet wird nichts abgefragt. */
(async () => {
  const $ = id => document.getElementById(id);
  const s = await messenger.storage.local.get(nbUpdates.DEFAULTS);
  const choice = { ...(s.updatesManaged || {}) };
  let last = null; // Ergebnis der letzten Prüfung

  const enable = $("updEnabledBox");
  const body = $("updBody");
  const channel = $("updChannelSel");
  const onStart = $("updOnStartBox");
  const info = $("updInfo");
  const log = $("updLog");
  const table = $("updTable");
  const applyBtn = $("updApply");
  const downBtn = $("updDowngrade");
  const restartBtn = $("updRestart");
  const checkBtn = $("updCheck");

  const tx = (key, ...subs) => subs.reduce((str, v, i) => str.replace(`$${i + 1}`, v), t[key] ?? key);
  const syncOff = () => {
    body.classList.toggle("off", !enable.checked);
    for (const el of body.querySelectorAll("button, select, input")) el.disabled = !enable.checked;
  };

  enable.checked = s.updatesEnabled === true;
  channel.value = s.updatesChannel === "testing" ? "testing" : "stable";
  onStart.checked = s.updatesOnStart !== false;
  for (const r of document.querySelectorAll("input[name=updMode]")) {
    r.checked = r.value === (s.updatesMode === "auto" ? "auto" : "show");
    r.addEventListener("change", () => r.checked && save({ updatesMode: r.value }));
  }
  enable.addEventListener("change", () => {
    save({ updatesEnabled: enable.checked });
    syncOff();
    if (enable.checked && !last) runCheck();
  });
  channel.addEventListener("change", () => {
    save({ updatesChannel: channel.value });
    runCheck();
  });
  onStart.addEventListener("change", () => save({ updatesOnStart: onStart.checked }));
  syncOff();

  function el(tag, text, cls) {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  function render() {
    const tb = table.querySelector("tbody");
    tb.textContent = "";
    if (!last) {
      table.hidden = true;
      return;
    }
    table.hidden = false;
    for (const row of last.rows) {
      const tr = el("tr");
      const status = row.status === "incompatible" ? tx("st_incompatible", row.entry?.minApp || "") : tx(`st_${row.status}`);
      const box = el("input");
      box.type = "checkbox";
      box.checked = row.managed;
      box.disabled = !enable.checked;
      box.addEventListener("change", () => {
        choice[row.id] = box.checked;
        row.managed = box.checked;
        save({ updatesManaged: { ...choice } });
        syncButtons();
      });
      const tdBox = el("td", undefined, "c");
      tdBox.append(box);
      tr.append(el("td", row.name), el("td", row.installed || "–"), el("td", row.available || "–"), el("td"), tdBox);
      tr.children[3].append(el("span", status, `upd-st ${row.status}`));
      tb.append(tr);
    }
    syncButtons();
  }

  function syncButtons() {
    const todo = last ? nbUpdates.pending(last.rows) : [];
    const older = last ? last.rows.filter(r => r.managed && r.status === "newer") : [];
    applyBtn.hidden = !todo.length;
    downBtn.hidden = !older.length;
    if (last && !todo.length && !log.textContent) log.textContent = t.updNothing;
  }

  async function runCheck() {
    if (!enable.checked) return;
    info.textContent = t.updChecking;
    log.textContent = "";
    try {
      last = await nbUpdates.check(channel.value, choice);
      const when = new Date().toLocaleString(document.documentElement.lang);
      info.textContent = tx("updChecked", channel.value === "testing" ? t.updTesting : t.updStable, last.built || "?", last.commit || "?", when);
      save({ updatesLastCheck: Date.now() });
    } catch (e) {
      last = null;
      info.textContent = tx("updErr", String(e?.message || e));
    }
    render();
  }

  async function install(rows) {
    if (!rows.length) return;
    checkBtn.disabled = applyBtn.disabled = downBtn.disabled = true;
    const lines = [];
    let any = false;
    await nbUpdates.apply(rows, (row, result) => {
      if (result.self) lines.push(t.updSelf);
      else if (result.ok) {
        any = true;
        lines.push(`✓ ${row.name} ${result.version || row.available}`);
      } else lines.push(tx("updFailed", row.name, result.error || "?"));
      log.textContent = lines.join("\n");
    });
    if (any) {
      lines.push(t.updDone);
      log.textContent = lines.join("\n");
      restartBtn.hidden = false;
    }
    checkBtn.disabled = applyBtn.disabled = downBtn.disabled = false;
    const keep = log.textContent;
    await runCheck();
    log.textContent = keep;
  }

  checkBtn.addEventListener("click", runCheck);
  applyBtn.addEventListener("click", () => {
    const rows = nbUpdates.pending(last?.rows || []);
    log.textContent = rows.map(r => tx("updInstalling", `${r.name} ${r.available}`)).join("\n");
    install(rows);
  });
  downBtn.addEventListener("click", () => install((last?.rows || []).filter(r => r.managed && r.status === "newer")));
  restartBtn.addEventListener("click", () => messenger.onlineUpdates.restart());

  if (enable.checked) runCheck();
})();
