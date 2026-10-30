// Übernimmt die Anweisung der KI-Zusammenfassung (novabird-extension/ai/ai.js) als Standard in den NovaBird Helper
// (novabird-helper/web/prompts.json; die Web-Oberfläche zeigt sie, eine eigene Fassung ersetzt sie dort).
//   node tools/sync-helper-prompts.mjs          schreibt die Datei
//   node tools/sync-helper-prompts.mjs --check  prüft nur (Exit 1, wenn veraltet; so auch im Test)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "novabird-helper", "web", "prompts.json");

export function prompts() {
  const ctx = { crypto: globalThis.crypto, console, URL, TextEncoder, TextDecoder };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(ROOT, "novabird-extension", "ai", "ai.js"), "utf8") + "\nglobalThis.nbAI = nbAI;", ctx);
  const out = {};
  for (const lang of ["de", "en", "fr", "es"]) {
    // promptTemplate liefert Hauptteil + Erinnerung + Warnauftrag; der Hauptteil ist alles vor der Erinnerung
    const meta = ctx.nbAI.prompt({ aiLang: "ui" }, lang, "", "", false).meta;
    const full = { mail: ctx.nbAI.promptTemplate(lang, false), thread: ctx.nbAI.promptTemplate(lang, true) };
    const split = t => t.slice(0, t.lastIndexOf("\n\n", t.lastIndexOf("\n") - 1));
    out[lang] = { mail: split(full.mail), thread: split(full.thread), target: meta.target };
  }
  return JSON.stringify(out, null, 1) + "\n";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const now = prompts();
  let old = "";
  try {
    old = readFileSync(OUT, "utf8");
  } catch {
    /* noch nicht da */
  }
  if (process.argv.includes("--check")) {
    if (old !== now) {
      console.error("novabird-helper/web/prompts.json ist veraltet: node tools/sync-helper-prompts.mjs");
      process.exit(1);
    }
    console.log("prompts.json aktuell");
  } else {
    writeFileSync(OUT, now, "utf8");
    console.log("geschrieben:", OUT);
  }
}
