/* NovaBird – Selbsttest, Teil Optionsseite (Quelle: Source/shared/selftest-ui.js; im Paket shared/selftest-ui.js).
 * Zeigt oben auf der Optionsseite einen Hinweis, wenn Funktionen wegen fehlender Betterbird-Interna aus sind
 * (storage.local "selfTest", geschrieben von shared/selftest-bg.js). Beim Öffnen fordert sie eine frische Prüfung an
 * (storage.local "selfTestRequest"); das Ergebnis kommt über storage.onChanged. t(key, [subs]) übersetzt; Schlüssel:
 * selfTestTitle, selfTestText ($1 = Programm und Version), selfTestHint, selfTest_<Funktion>.
 */
"use strict";

function nbShowSelfTest(container, t) {
  const api = globalThis.messenger ?? globalThis.browser;
  if (!container || !api) return;
  const render = res => {
    container.textContent = "";
    container.hidden = !res?.missing?.length;
    if (container.hidden) return;
    Object.assign(container.style, {
      margin: "0 0 16px", padding: "10px 14px", borderRadius: "8px",
      borderLeft: "4px solid #d9822b", background: "color-mix(in srgb, #d9822b 14%, transparent)",
    });
    const add = (tag, text) => {
      const el = document.createElement(tag);
      el.textContent = text;
      container.append(el);
      return el;
    };
    add("strong", t("selfTestTitle"));
    add("p", t("selfTestText", [`${res.app} ${res.version}`])).style.margin = "6px 0";
    const list = add("ul", "");
    list.style.margin = "0 0 6px";
    for (const feature of res.missing) {
      const li = document.createElement("li");
      li.textContent = t("selfTest_" + feature) || feature;
      list.append(li);
    }
    add("p", t("selfTestHint")).style.margin = "0";
  };
  api.storage.local.get("selfTest").then(r => render(r.selfTest)).catch(() => {});
  api.storage.local.set({ selfTestRequest: Date.now() }).catch(() => {});
  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.selfTest) render(changes.selfTest.newValue);
  });
}
