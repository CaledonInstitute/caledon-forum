import { useEffect, useState } from "react";
import type { KeyMetadata } from "../lib/api-keys";

export default function ApiKeyPanel({ eligible }: { eligible: boolean }) {
  const [metadata, setMetadata] = useState<KeyMetadata | null>(null),
    [secret, setSecret] = useState(""),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function request<T>(method = "GET", operation?: string) {
    const response = await fetch("/api/account/key", {
      method,
      headers: operation ? { "Content-Type": "application/json" } : undefined,
      body: operation ? JSON.stringify({ operation }) : undefined,
      cache: "no-store",
    });
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(data.error || "Unable to manage your API key.");
    return data;
  }
  useEffect(() => {
    if (!eligible) {
      setBusy(false);
      return;
    }
    let active = true;
    request<{ key: KeyMetadata | null }>()
      .then((data) => {
        if (active) setMetadata(data.key);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [eligible]);
  async function change(operation: "generate" | "regenerate" | "revoke") {
    if (
      operation !== "generate" &&
      !window.confirm(`${operation === "revoke" ? "Revoke" : "Regenerate"} your API key? Integrations using the current key will stop working immediately.`)
    )
      return;
    setBusy(true);
    setError("");
    setMessage("");
    setSecret("");
    try {
      const data = await request<KeyMetadata & { key?: string }>(operation === "revoke" ? "DELETE" : "POST", operation === "revoke" ? undefined : operation);
      setMetadata(operation === "revoke" ? null : { prefix: data.prefix, createdAt: data.createdAt, lastUsedAt: data.lastUsedAt });
      setSecret(data.key || "");
      setMessage(operation === "revoke" ? "API key revoked." : "Copy your key now. It will not be shown again.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-group">
      <h2>API access</h2>
      <p>Use your API key to manage your profile, posts, replies, likes, reports, and notifications from scripts or bots. Keep it private.</p>
      <p>
        <a className="text-link" href="/api/docs">
          Open Swagger API documentation
        </a>
      </p>
      {!eligible ? (
        <p className="notice">Choose a username and verify your email to use API keys. Your account must be active.</p>
      ) : (
        <>
          <p>{metadata ? "Active key" : "No active API key"}</p>
          {metadata && (
            <dl className="api-key-details">
              <dt>Key</dt>
              <dd>
                <code>{metadata.prefix}…</code>
              </dd>
              <dt>Created</dt>
              <dd>{new Date(metadata.createdAt).toLocaleString()}</dd>
              <dt>Last used</dt>
              <dd>{metadata.lastUsedAt ? new Date(metadata.lastUsedAt).toLocaleString() : "Never"}</dd>
              <dt>Expires</dt>
              <dd>Valid until revoked or regenerated</dd>
            </dl>
          )}
          {secret && (
            <div className="form">
              <label>
                New API key
                <input readOnly value={secret} spellCheck={false} autoComplete="off" onFocus={(e) => e.currentTarget.select()} />
              </label>
              <button
                className="button secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(secret);
                    setMessage("API key copied.");
                  } catch {
                    setError("Copy the key from the field above.");
                  }
                }}
              >
                Copy key
              </button>
            </div>
          )}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
            {metadata ? (
              <>
                <button className="button secondary" disabled={busy} onClick={() => change("regenerate")}>
                  Regenerate API key
                </button>
                <button className="text-button" disabled={busy} onClick={() => change("revoke")}>
                  Revoke API key
                </button>
              </>
            ) : (
              <button className="button" disabled={busy} onClick={() => change("generate")}>
                Generate API key
              </button>
            )}
          </div>
        </>
      )}
      <p className="error" role="alert">
        {error}
      </p>
      <p className="success" role="status">
        {message}
      </p>
    </section>
  );
}
