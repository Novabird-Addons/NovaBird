// Temporäre Test-Oberfläche des NovaBird-DB (Popup). Die eigentliche Suchleiste kommt später aus NovaBird-Search.
const $ = (id) => document.getElementById(id);
const send = (msg) => messenger.runtime.sendMessage(msg);
window.dbp = send;

let query = null; // zuletzt geparste Anfrage (für Chip-Entfernung)
let timer = null;
let seq = 0;

const fmtDate = (ms) => new Date(ms).toLocaleDateString("de-DE");

function renderChips(chips) {
  const box = $("chips");
  box.replaceChildren();
  for (const c of chips) {
    const el = document.createElement("span");
    el.className = "chip";
    const [kind, idx] = c.id.split(":");
    const person = query?.[kind]?.[Number(idx)];
    if (c.ambiguous && person?.candidates?.length) {
      // Mehrdeutige Person: Auswahl anbieten, danach mit der gewählten Adresse neu suchen
      const sel = document.createElement("select");
      sel.append(new Option(c.label + " – wer?", ""));
      person.candidates.forEach((cand, i) => sel.append(new Option(`${cand.name} <${cand.email}> (${cand.count})`, String(i))));
      sel.addEventListener("change", () => {
        if (sel.value === "") return;
        const cand = person.candidates[Number(sel.value)];
        person.resolved = { name: cand.name, email: cand.email, emails: [cand.email] };
        runSearch({ query });
      });
      el.append(sel);
    } else {
      el.textContent = c.label;
    }
    const x = document.createElement("button");
    x.textContent = "✕";
    x.title = "Entfernen";
    x.addEventListener("click", () => runSearch({ removeChip: c.id }));
    el.append(x);
    box.append(el);
  }
}

function renderRows(rows) {
  const list = $("list");
  list.replaceChildren();
  for (const r of rows) {
    const el = document.createElement("div");
    el.className = "row";
    const s = document.createElement("div");
    s.className = "s";
    s.textContent = r.subject || "(ohne Betreff)";
    const m = document.createElement("div");
    m.className = "m";
    m.textContent = `${r.author_name || r.author_email} · ${fmtDate(r.date)} · ${r.folder_name}`;
    el.append(s, m);
    el.addEventListener("click", () => {
      send({ type: "novabird-db:logQuery", text: $("q").value });
      send({ type: "novabird-db:open", row: r });
    });
    list.append(el);
  }
}

async function runSearch({ removeChip, query: given } = {}) {
  const my = ++seq;
  const text = $("q").value.trim();
  let res;
  if (given) {
    res = await send({ type: "novabird-db:search", query: given, limit: 100, sort: $("sort").value });
  } else if (removeChip && query) {
    res = await send({ type: "novabird-db:removeChip", query, chipId: removeChip, sort: $("sort").value });
  } else {
    if (!text) {
      query = null;
      renderChips([]);
      renderRows([]);
      $("status").textContent = "";
      return;
    }
    res = await send({ type: "novabird-db:search", text, limit: 100, sort: $("sort").value });
  }
  if (my !== seq) return; // veraltete Antwort
  if (res?.error) {
    $("status").textContent = "Fehler: " + res.error;
    return;
  }
  query = res.query;
  renderChips(res.chips);
  renderRows(res.rows);
  $("status").textContent = `${res.rows.length} Treffer · ${res.ms} ms`;
  const sg = res.suggest;
  $("suggest").hidden = !sg;
  if (sg) $("suggestLink").textContent = sg.text;
}

$("q").addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(() => runSearch(), 250);
});

$("q").addEventListener("keydown", (e) => {
  if (e.key === "Enter") send({ type: "novabird-db:logQuery", text: $("q").value });
});

async function pollProgress() {
  const s = await send({ type: "novabird-db:status" });
  const prog = $("prog");
  if (s?.status?.phase === "folder") {
    prog.hidden = false;
    const { done, total } = s.status;
    let text = `Index wird aufgebaut … ${s.messages} Mails (${s.status.folder})`;
    if (total) {
      prog.max = total;
      prog.value = Math.min(done, total);
      text = `Index wird aufgebaut … ${Math.min(100, Math.round((done / total) * 100))} % (${s.status.folder})`;
    } else {
      prog.removeAttribute("value");
    }
    $("status").textContent = text;
  } else {
    prog.hidden = true;
    if (s?.headersOnly && !$("q").value.trim()) {
      $("status").textContent = `${s.messages} Mails im Index, davon ${s.headersOnly} ohne Text (nicht lokal gespeichert)`;
    }
  }
}
setInterval(pollProgress, 1000);

$("run").addEventListener("click", async () => {
  $("out").textContent = JSON.stringify(await send({ type: "novabird-db:debug" }), null, 2);
});
$("index").addEventListener("click", async () => {
  $("out").textContent = "…";
  $("out").textContent = JSON.stringify(await send({ type: "novabird-db:fullRun" }), null, 2);
});

$("opts").addEventListener("click", (e) => {
  e.preventDefault();
  messenger.runtime.openOptionsPage();
  window.close();
});

window.dbpStore = (o) => messenger.storage.local.set(o); // nur für Tests (z. B. forceFts4)

$("sort").addEventListener("change", () => runSearch());

$("suggestLink").addEventListener("click", (e) => {
  e.preventDefault();
  $("q").value = $("suggestLink").textContent;
  runSearch();
});
