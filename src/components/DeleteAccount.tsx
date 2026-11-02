import { useEffect, useRef, useState } from "react";
const forgetIdentity = async () => (await import("../lib/dm-crypto")).forgetIdentity();
const storageKey = "caledon-delete-account";
async function post(path: string, data: unknown) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const result = (await response.json()) as { error?: string; message?: string; token: string };
  if (!response.ok) throw new Error(result.error || result.message || "Unable to delete your account. Try again.");
  return result;
}
export default function DeleteAccount({ username }: { username?: string | null }) {
  const dialog = useRef<HTMLDialogElement>(null),
    [token, setToken] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (new URL(location.href).searchParams.get("delete") === "confirm") {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        setToken(saved);
        dialog.current?.showModal();
      }
    }
  }, []);
  async function prepare() {
    setBusy(true);
    setError("");
    try {
      const result = await post("/api/account/delete", { action: "prepare" });
      sessionStorage.setItem(storageKey, result.token);
      await post("/api/auth/sign-out", {});
      await forgetIdentity();
      location.assign("/login?reauth=delete");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await post("/api/account/delete", { token, confirmation });
      sessionStorage.removeItem(storageKey);
      await forgetIdentity().catch(() => {});
      location.assign("/?account=deleted");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <section className="settings-group delete-account">
      <h2>Delete account</h2>
      <p>Your profile, posts, replies and uploaded files will be removed. All your DM conversations and their attachments will be removed for both participants.</p>
      <p className="help">Replies from other members remain. Files already downloaded by someone else cannot be recalled.</p>
      <button
        type="button"
        className="button danger-outline"
        onClick={() => {
          setError("");
          dialog.current?.showModal();
        }}
      >
        Delete account
      </button>
      <dialog
        ref={dialog}
        className="delete-dialog"
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <h2>Delete your account?</h2>
        <p>This permanently removes your account and content. This action cannot be undone.</p>
        {token ? (
          <>
            <p>
              Type <strong>{username || "DELETE"}</strong> to confirm.
            </p>
            <label>
              Confirmation
              <input autoComplete="off" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} disabled={busy} />
            </label>
            <p className="help">Your sign-in confirmation is valid for five minutes. Start again if it expires.</p>
          </>
        ) : (
          <p>First, sign in again with a sign-in method connected to this account. You will return here to confirm deletion.</p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={() => dialog.current?.close()}>
            Cancel
          </button>
          {token ? (
            <>
              <button type="button" className="text-button" disabled={busy} onClick={() => void prepare()}>
                Sign in again
              </button>
              <button type="button" className="button danger" disabled={busy || confirmation !== (username || "DELETE")} onClick={() => void remove()}>
                {busy ? "Deleting…" : "Delete account"}
              </button>
            </>
          ) : (
            <button type="button" className="button" disabled={busy} onClick={() => void prepare()}>
              {busy ? "Working…" : "Sign in again"}
            </button>
          )}
        </div>
      </dialog>
    </section>
  );
}
