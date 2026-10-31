"use strict";

/* Einstellungsseite in der Add-on-Verwaltung: Dort ist die Seite sehr schmal. Statt der Einstellungen steht nur ein Verweis
 * auf Einstellungen → NovaBird (volle Breite, ein Reiter je Add-on). Dort wird die Seite mit ?hub=1 geladen und normal gezeigt.
 * open(): öffnet den Reiter des Add-ons; available(): gibt es die NovaBird-Seite (NovaBird-Extension aktiv)? Sonst bleibt alles wie bisher.
 * „Hier anzeigen“ zeigt die Einstellungen trotzdem an Ort und Stelle. */
async function nbHubNote(name, open, available = async () => true) {
  if (new URLSearchParams(location.search).has("hub") || !(await available().catch(() => false))) {
    return;
  }
  const T = {
    de: { title: "Einstellungen von $1", text: "Die Einstellungen von NovaBird stehen in den Thunderbird-Einstellungen unter „NovaBird“ – dort in voller Breite und mit allen NovaBird-Add-ons zusammen.", open: "Einstellungen öffnen", here: "Hier anzeigen" },
    en: { title: "$1 settings", text: "NovaBird's settings are in the Thunderbird settings under “NovaBird” – full width and together with all NovaBird add-ons.", open: "Open settings", here: "Show here" },
    fr: { title: "Paramètres de $1", text: "Les paramètres de NovaBird se trouvent dans les paramètres de Thunderbird, sous « NovaBird » – en pleine largeur et avec tous les modules NovaBird.", open: "Ouvrir les paramètres", here: "Afficher ici" },
    es: { title: "Ajustes de $1", text: "Los ajustes de NovaBird están en los ajustes de Thunderbird, en «NovaBird»: a todo el ancho y junto con todos los complementos NovaBird.", open: "Abrir ajustes", here: "Mostrar aquí" },
  };
  const t = T[(messenger.i18n.getUILanguage() || "en").slice(0, 2).toLowerCase()] || T.en;
  const style = document.createElement("style");
  style.textContent = `
    html.nbx-addons body > :not(#nbxHubNote) { display: none !important; }
    #nbxHubNote { margin: 1.5rem 1rem; padding: 1.2rem 1.4rem; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 0.8rem; max-width: 34rem; }
    #nbxHubNote h2 { margin: 0 0 0.5rem; font-size: 1.15em; }
    #nbxHubNote p { margin: 0 0 1rem; line-height: 1.45; }
    #nbxHubNote .row { display: flex; flex-direction: column; align-items: flex-start; gap: 0.6rem; }
    #nbxHubNote .open { padding: 0.4rem 1rem; border: 0; border-radius: 0.4rem; background: AccentColor; color: AccentColorText; font: inherit; cursor: pointer; }
    #nbxHubNote .here { color: inherit; opacity: 0.8; }`;
  const box = document.createElement("section");
  box.id = "nbxHubNote";
  const h = Object.assign(document.createElement("h2"), { textContent: t.title.replace("$1", name) });
  const p = Object.assign(document.createElement("p"), { textContent: t.text });
  const go = Object.assign(document.createElement("button"), { type: "button", className: "open", textContent: t.open });
  const here = Object.assign(document.createElement("a"), { href: "#", className: "here", textContent: t.here });
  const row = document.createElement("div");
  row.className = "row";
  row.append(go, here);
  box.append(h, p, row);
  const show = () => {
    document.documentElement.classList.remove("nbx-addons");
    box.remove();
  };
  go.addEventListener("click", () => open().catch(show));
  here.addEventListener("click", e => {
    e.preventDefault();
    show();
  });
  document.head.append(style);
  document.body.prepend(box);
  document.documentElement.classList.add("nbx-addons");
}
