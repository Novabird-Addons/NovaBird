// KI-Ergebnisse teilen (AiCache.cs) und Modellwahl je PC (Chat.Choices) über einen Test-Helper:
//   node aishare.mjs <exe> <datenordner> <netport> <webport>
// Der Datenordner braucht das Suchmodell und für die Modellwahl ein vom Helper verwaltetes Ollama mit mehreren Modellen
// (settings.json: ollamaEnabled, ollamaPort, chatModel "ollama:…"). Zwei Clients spielen zwei PCs derselben Gruppe.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import crypto from "node:crypto";
const S = new URL("../../novabird-search/semantic/", import.meta.url).href;
const server = await import(S + "server.js");
const [exe, dir, netPort, webPort] = process.argv.slice(2);
const out = {};
const ok = (name, cond, info) => { out[name] = cond ? "ok" : { fail: info }; };

function startHelper() {
  const child = spawn(exe, ["--server-console", "--loopback"], { env: { ...process.env, NOVABIRD_HELPER_DIR: dir, NOVABIRD_NET_PORT: netPort, NOVABIRD_WEB_PORT: webPort } });
  child.stderr.on("data", () => {});
  const lines = createInterface({ input: child.stdout });
  return new Promise(r => lines.once("line", l => r({ child, start: JSON.parse(l) })));
}
async function stopHelper(child) {
  child.stdin.end();
  await new Promise(r => child.once("exit", r));
}
const id = () => crypto.randomBytes(32).toString("base64url");

let { child, start } = await startHelper();
const A = { type: "nbhelper", url: `http://127.0.0.1:${netPort}`, code: start.code, clientId: "aipc000001", label: "PC A" };
const B = { ...A, clientId: "aipc000002", label: "PC B" };
const kept = id();
try {
  const hello = await server.netCall(A, "hello", {});
  ok("helloAiCache", hello.aiCache === true, hello);
  ok("choicesHaveSelected", Array.isArray(hello.chatChoices) && hello.chatChoices.includes(hello.chatModel), hello.chatChoices);
  ok("choicesWithoutEmbed", !hello.chatChoices.some(m => /bge|jina|embed/i.test(m)), hello.chatChoices);
  out.choices = hello.chatChoices;

  // A meldet an, B wartet, A legt ab, B bekommt es
  const x = id();
  let r = await server.netCall(A, "aiget", { ids: [x], claim: true });
  ok("firstClaims", r.items[x]?.claimed === true, r);
  r = await server.netCall(B, "aiget", { ids: [x], claim: true });
  ok("secondPending", r.items[x]?.pending === true, r);
  r = await server.netCall(A, "aiget", { ids: [x], claim: true });
  ok("sameClientClaimsAgain", r.items[x]?.claimed === true, r);
  await server.netCall(A, "aiput", { id: x, data: "Q2hpZmZyYXQ=" });
  r = await server.netCall(B, "aiget", { ids: [x], claim: true });
  ok("secondGetsData", r.items[x]?.data === "Q2hpZmZyYXQ=", r);

  // Abgeben: Rechnen fehlgeschlagen, ein anderer darf sofort
  const y = id();
  await server.netCall(A, "aiget", { ids: [y], claim: true });
  await server.netCall(A, "airelease", { id: y });
  r = await server.netCall(B, "aiget", { ids: [y], claim: true });
  ok("releaseLetsOtherClaim", r.items[y]?.claimed === true, r);
  // B kann A's Anmeldung nicht zurückgeben
  const z = id();
  await server.netCall(A, "aiget", { ids: [z], claim: true });
  await server.netCall(B, "airelease", { id: z });
  r = await server.netCall(B, "aiget", { ids: [z], claim: true });
  ok("foreignReleaseIgnored", r.items[z]?.pending === true, r);
  // Ohne claim: nur nachsehen
  const w = id();
  r = await server.netCall(B, "aiget", { ids: [w] });
  ok("lookupWithoutClaim", r.items[w] && !r.items[w].claimed && !r.items[w].pending && !r.items[w].data, r);

  // Ungültiges
  r = await server.netCall(A, "aiget", { ids: ["../../win.ini", "kurz"], claim: true });
  ok("badIdsIgnored", Object.keys(r.items).length === 0, r);
  try { await server.netCall(A, "aiget", { ids: Array.from({ length: 201 }, id) }); out.tooManyIds = { fail: "angenommen" }; }
  catch (e) { ok("tooManyIds", /Anzahl/.test(e.message), e.message); }
  try { await server.netCall(A, "aiput", { id: id(), data: "x".repeat(49 * 1024) }); out.tooBig = { fail: "angenommen" }; }
  catch (e) { ok("tooBig", /ungültig/.test(e.message), e.message); }
  try { await server.netCall(A, "aiput", { id: "../x", data: "abc" }); out.badPutId = { fail: "angenommen" }; }
  catch (e) { ok("badPutId", /ungültig/.test(e.message), e.message); }

  await server.netCall(A, "aiput", { id: kept, data: "YmxlaWJ0" });

  // Modellwahl: nicht vorhandenes Modell abgelehnt, ein anderes aus der Liste rechnet
  try { await server.netCall(A, "chat", { messages: [{ role: "user", content: "Hi" }], maxNew: 8, model: "ollama:gibtsnicht:1b" }); out.unknownModel = { fail: "angenommen" }; }
  catch (e) { ok("unknownModel", /nicht/.test(e.message), e.message); }
  const other = hello.chatChoices.find(m => m !== hello.chatModel && m.startsWith("ollama:"));
  if (other) {
    const t0 = Date.now();
    const { id: job } = await server.netCall(A, "chat", { messages: [{ role: "user", content: "Antworte nur mit dem Wort: Hallo" }], maxNew: 16, model: other });
    let text = "";
    let stats = null;
    for (let i = 0; i < 600; i++) {
      const p = await server.netCall(A, "chatPoll", { id: job });
      text += p.text || "";
      if (p.error) throw new Error(p.error);
      if (p.done) { stats = p.stats; break; }
    }
    ok("otherModelAnswers", text.trim().length > 0 && stats?.model === other, { text, stats });
    out.otherModel = `${other}: ${JSON.stringify(text.trim())} in ${Date.now() - t0} ms`;
  } else out.otherModel = "nur ein Modell – übersprungen";
} catch (e) {
  out.error = String(e.stack || e);
} finally {
  await stopHelper(child);
}

// Nach dem Neustart noch da (gespeichert beim Beenden)
try {
  ({ child, start } = await startHelper());
  const r = await server.netCall(A, "aiget", { ids: [kept] });
  ok("survivesRestart", r.items[kept]?.data === "YmxlaWJ0", r);
} catch (e) {
  out.error2 = String(e.stack || e);
} finally {
  await stopHelper(child);
}
const failed = Object.entries(out).filter(([, v]) => v && typeof v === "object" && !Array.isArray(v) && v.fail);
console.log(JSON.stringify(out, null, 1));
console.log(failed.length ? `FEHLER: ${failed.length}` : `alle ${Object.values(out).filter(v => v === "ok").length} ok`);
