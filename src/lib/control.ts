import { env } from "cloudflare:workers";
export function control() {
  return env.FORUM_CONTROL?.getByName("global-v1");
}
export async function signalChange() {
  if (env.REALTIME_ENABLED !== "true") return;
  try {
    await control()?.fetch("https://control/change", { method: "POST" });
  } catch {
    console.warn("Realtime signal unavailable");
  }
}
export async function reserveBudget(kind: string, limit: number) {
  const stub = control();
  if (!stub) return false;
  const response = await stub.fetch("https://control/budget", { method: "POST", body: JSON.stringify({ kind, limit }) });
  return response.ok;
}

export async function signalDirectMessages(users: string[]) {
  if (env.REALTIME_ENABLED !== "true") return;
  try {
    await control()?.fetch("https://control/dm-change", { method: "POST", body: JSON.stringify({ users }) });
  } catch {
    console.warn("Private update signal unavailable");
  }
}
