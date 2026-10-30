// VAPID private material goes directly to Wrangler stdin; never to console or disk.
import { spawn } from "node:child_process";
import webpush from "web-push";
function wrangler(args, input, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/wrangler/bin/wrangler.js", ...args], { windowsHide: true, stdio: ["pipe", capture ? "pipe" : "inherit", "inherit"] });
    let output = "";
    if (capture) child.stdout.on("data", (chunk) => (output += chunk.toString()));
    child.on("error", reject);
    child.on("exit", (code) => (code ? reject(new Error(`Wrangler failed (${code})`)) : resolve(output)));
    child.stdin.end(input ? `${input}\n` : "");
  });
}
const existing = JSON.parse(await wrangler(["secret", "list"], undefined, true));
const hasPublic = existing.some((s) => s.name === "VAPID_PUBLIC_KEY");
const hasPrivate = existing.some((s) => s.name === "VAPID_PRIVATE_KEY");
if (hasPublic !== hasPrivate) throw new Error("Incomplete VAPID configuration; inspect existing secrets before replacing keys.");
if (!hasPublic) {
  const pair = webpush.generateVAPIDKeys();
  await wrangler(["secret", "put", "VAPID_PRIVATE_KEY"], pair.privateKey);
  await wrangler(["secret", "put", "VAPID_PUBLIC_KEY"], pair.publicKey);
}
if (!existing.some((s) => s.name === "VAPID_SUBJECT")) await wrangler(["secret", "put", "VAPID_SUBJECT"], "https://caledon-forum.supervoid.workers.dev/privacy");
console.log("VAPID configuration ready. Existing key pairs were preserved.");
