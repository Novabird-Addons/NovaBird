"use strict";

/* Fristen (Popup unter der Zusammenfassung, Überblick): Liste mit „Erinnern“. Der Knopf öffnet den Aufgaben-Dialog von
 * Thunderbird mit Fälligkeit und Erinnerung am Vortag um 9 Uhr; angelegt wird erst beim Speichern dort. Kalender: der feste
 * aus den Einstellungen, sonst fragt der Dialog.
 * Dazu, für Fristen, „Zu erledigen“ im Überblick und die Termine im Popup: Was hat NovaBird aus einer Mail schon in einen
 * Kalender eingetragen? Jeder Eintrag trägt die Kennung der Mail (X-NOVABIRD-MAIL, nbAI.mailKey); geteilte Kalender des
 * Helpers geben sie an die anderen PCs und Kollegen weiter. */
const nbDeadlines = (() => {
  const TEXTS = {
    de: { title: "Fristen", remind: "Erinnern", reminded: "Aufgabe geöffnet", today: "heute", tomorrow: "morgen", overdue: "überfällig", due: "fällig $1", fromMail: "Aus der E-Mail", inCal: "Im Kalender", inCalTip: "Schon im Kalender „$1“", hint: "„Erinnern“ öffnet die Aufgabe mit Erinnerung am Vortag um 9 Uhr – eingetragen wird beim Speichern." },
    en: { title: "Deadlines", remind: "Remind me", reminded: "Task opened", today: "today", tomorrow: "tomorrow", overdue: "overdue", due: "due $1", fromMail: "From the e-mail", inCal: "In calendar", inCalTip: "Already in calendar “$1”", hint: "“Remind me” opens the task with a reminder at 9 am the day before – it is added when you save it." },
    fr: { title: "Échéances", remind: "Me rappeler", reminded: "Tâche ouverte", today: "aujourd’hui", tomorrow: "demain", overdue: "en retard", due: "échéance $1", fromMail: "Tiré de l’e-mail", inCal: "Dans l’agenda", inCalTip: "Déjà dans l’agenda « $1 »", hint: "« Me rappeler » ouvre la tâche avec un rappel la veille à 9 h – elle est ajoutée à l’enregistrement." },
    es: { title: "Plazos", remind: "Recordarme", reminded: "Tarea abierta", today: "hoy", tomorrow: "mañana", overdue: "vencido", due: "vence $1", fromMail: "Del correo", inCal: "En el calendario", inCalTip: "Ya está en el calendario «$1»", hint: "«Recordarme» abre la tarea con un aviso el día anterior a las 9 – se añade al guardarla." },
  };
  const lang = (messenger.i18n.getUILanguage() || "en").slice(0, 2).toLowerCase();
  const t = TEXTS[lang] || TEXTS.en;
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  function whenText(due) {
    const today = iso(new Date());
    const tomorrow = iso(new Date(Date.now() + 86400_000));
    if (due < today) return t.overdue;
    if (due === today) return t.today;
    if (due === tomorrow) return t.tomorrow;
    return t.due.replace("$1", new Date(`${due}T12:00`).toLocaleDateString(lang, { weekday: "short", day: "numeric", month: "short" }));
  }

  /** Einträge aus diesen Mails in allen Kalendern (leer ohne Kalender oder bei Fehlern). */
  const lookup = keys => (keys.length ? messenger.novaCalendar.mailItems([...new Set(keys)]).catch(() => []) : Promise.resolve([]));

  /** Steht schon etwas im Kalender? found aus lookup; alle keys müssen vorkommen, type und date nur, wenn angegeben.
   * Liefert den Namen des Kalenders oder "". */
  function inCalendar(found, { keys, type, date }) {
    if (!keys?.length || keys.some(k => !k)) return "";
    let name = "";
    for (const k of keys) {
      const hit = found.find(f => f.mail === k && (!type || f.type === type) && (!date || f.date === date.slice(0, 10)));
      if (!hit) return "";
      name ||= hit.calendar;
    }
    return name;
  }

  /** list: [{msgId, i, title, due, subject, author, reminded}]; onError(key) bei Fehlern des Dialogs. */
  function render(box, list, onError = () => {}) {
    box.replaceChildren();
    box.hidden = !list?.length;
    if (!list?.length) return;
    box.append(Object.assign(document.createElement("h4"), { textContent: t.title }));
    const soon = iso(new Date(Date.now() + 86400_000));
    const rows = [];
    for (const d of list) {
      const row = Object.assign(document.createElement("div"), { className: "dl" });
      row.classList.toggle("soon", d.due <= soon);
      const what = Object.assign(document.createElement("span"), { className: "what", textContent: d.title, title: `${d.subject || ""} – ${d.author || ""}` });
      const when = Object.assign(document.createElement("span"), { className: "when", textContent: whenText(d.due) });
      const btn = Object.assign(document.createElement("button"), { type: "button", textContent: d.reminded ? t.reminded : t.remind, disabled: Boolean(d.reminded) });
      row.classList.toggle("done", Boolean(d.reminded));
      rows.push({ d, row, btn });
      btn.addEventListener("click", async () => {
        try {
          const { aiCalendar } = await messenger.storage.local.get({ aiCalendar: "" });
          await messenger.novaCalendar.openItemDialogs([{
            type: "task", title: d.title.slice(0, 200), due: d.due, alarm: d.due > iso(new Date()) ? "dayBefore" : "", mail: d.mail || "",
            description: `${t.fromMail}: ${d.subject || ""} – ${d.author || ""}`,
          }], aiCalendar || undefined);
          d.reminded = true;
          btn.textContent = t.reminded;
          btn.disabled = true;
          row.classList.add("done");
          messenger.runtime.sendMessage({ type: "nbx-reminded", msgId: d.msgId, i: d.i }).catch(() => {});
        } catch (e) {
          onError(String(e.message || e).replace(/^Error: /, ""));
        }
      });
      row.append(what, when, btn);
      box.append(row);
    }
    box.append(Object.assign(document.createElement("div"), { className: "hint", textContent: t.hint }));
    markInCalendar(rows);
  }

  // Fristen, die (auch auf einem anderen PC) schon als Aufgabe mit diesem Datum im Kalender stehen
  async function markInCalendar(rows) {
    for (const r of rows) r.d.mail = await nbAI.mailKey(r.d.msgId);
    const found = await lookup(rows.map(r => r.d.mail).filter(Boolean));
    for (const { d, row, btn } of rows) {
      const name = inCalendar(found, { keys: [d.mail], type: "task", date: d.due });
      if (!name) continue;
      btn.textContent = t.inCal;
      btn.disabled = true;
      btn.title = t.inCalTip.replace("$1", name);
      row.classList.add("done");
    }
  }

  return { render, lookup, inCalendar, inCalTip: name => t.inCalTip.replace("$1", name) };
})();
