// Hält der Helper eine Verbindung mit halbem Kopf unbegrenzt offen? node slowhold.mjs <exe> <dir> <netport> <webport>
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import net from "node:net";
const [exe, dir, netPort, webPort] = process.argv.slice(2);
const child = spawn(exe, ["--server-console", "--loopback"], { env: { ...process.env, NOVABIRD_HELPER_DIR: dir, NOVABIRD_NET_PORT: netPort, NOVABIRD_WEB_PORT: webPort } });
await new Promise(r => createInterface({ input: child.stdout }).once("line", r));
const probe = port => new Promise(resolve => {
  const t0 = Date.now();
  const s = net.connect({ host: "127.0.0.1", port }, () => s.write("GET / HTTP/1.1\r\nHost: localhost\r\n"));
  s.on("close", () => resolve(Math.round((Date.now() - t0) / 1000)));
  s.on("error", () => {});
  setTimeout(() => { s.destroy(); resolve(">70"); }, 70000);
});
const [web, netp] = await Promise.all([probe(webPort), probe(netPort)]);
console.log(JSON.stringify({ webClosedAfterS: web, netClosedAfterS: netp }));
child.stdin.end();
