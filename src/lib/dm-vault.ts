import { signalDirectMessages } from "./control";
import { all, one, run } from "./db";
import { z } from "zod";
export const vaultSchema = z.object({
  salt: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  ciphertext: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .min(100)
    .max(4096),
});
export async function reconcileVault(userId: string) {
  const result = await run(
    `UPDATE dm_vaults SET vault=CASE WHEN pending_vault='reset' THEN '' ELSE pending_vault END,
    public_key=CASE WHEN pending_vault='reset' THEN '' ELSE public_key END,
    version=version+CASE WHEN pending_vault='reset' THEN 1 ELSE 0 END,
    invalidated=CASE WHEN pending_vault='reset' THEN 1 ELSE invalidated END,pending_vault=NULL,pending_password_hash=NULL,pending_at=NULL
    WHERE user_id=? AND pending_password_hash=(SELECT password FROM account WHERE user_id=? AND provider_id='credential' LIMIT 1)`,
    userId,
    userId
  );
  if (result.meta.changes) {
    const peers = await all<{ id: string }>("SELECT CASE WHEN user_a=? THEN user_b ELSE user_a END AS id FROM dm_conversations WHERE user_a=? OR user_b=?", userId, userId, userId);
    await signalDirectMessages([userId, ...peers.map((p) => p.id)]);
  }
}
export async function stagePasswordVault(userId: string, passwordHash: string, wrapped: unknown, reset: boolean) {
  await reconcileVault(userId);
  await run("UPDATE dm_vaults SET pending_vault=NULL,pending_password_hash=NULL,pending_at=NULL WHERE user_id=? AND pending_at<?", userId, Date.now() - 120000);
  const v = await one<{ invalidated: number; pending_vault: string | null }>("SELECT invalidated,pending_vault FROM dm_vaults WHERE user_id=?", userId);
  if (!v || v.invalidated) return;
  if (v.pending_vault) throw new Error("A password update is pending. Try again shortly.");
  const vault = reset ? "reset" : JSON.stringify(vaultSchema.parse(wrapped));
  const result = await run(
    "UPDATE dm_vaults SET pending_vault=?,pending_password_hash=?,pending_at=? WHERE user_id=? AND pending_vault IS NULL",
    vault,
    passwordHash,
    Date.now(),
    userId
  );
  if (!result.meta.changes) throw new Error("Another password update is in progress.");
}
