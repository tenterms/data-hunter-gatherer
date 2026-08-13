"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * "Sign in with Google" for Search Console. Account-level connect/disconnect
 * (shown on the home page), and — when a clientKey is passed (report settings
 * page) — a property picker listing everything the connected account can see,
 * so setting up a client is choose-from-a-list instead of granting the
 * service-account email access every time.
 */

interface PropertiesResponse {
  connected: boolean;
  email: string | null;
  configured: boolean;
  usingOAuth: boolean;
  properties: Array<{ siteUrl: string; permissionLevel: string }>;
  propertiesError?: string;
  currentProperty: string | null;
}

export default function GoogleGscPanel({ clientKey }: { clientKey?: string }) {
  const [data, setData] = useState<PropertiesResponse | null>(null);
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/google/properties${clientKey ? `?clientKey=${encodeURIComponent(clientKey)}` : ""}`);
    const body = (await res.json()) as PropertiesResponse;
    setData(body);
    setSelected((prev) => prev || body.currentProperty || "");
  }, [clientKey]);

  useEffect(() => {
    load().catch(() => setMessage("Couldn't load the Google connection status."));
  }, [load]);

  useEffect(() => {
    // Surface the result of the OAuth round-trip (?google=connected / error).
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("google");
    if (outcome === "connected") setMessage(`Google connected${params.get("account") ? ` as ${params.get("account")}` : ""}.`);
    if (outcome === "error") setMessage(`Google connection failed: ${params.get("message") ?? "unknown error"}`);
  }, []);

  const disconnect = async () => {
    setBusy(true);
    const res = await fetch("/api/google/disconnect", { method: "POST" });
    const body = await res.json();
    setMessage(body.message ?? "Disconnected.");
    setBusy(false);
    await load();
  };

  const saveProperty = async () => {
    if (!clientKey || !selected) return;
    setBusy(true);
    const res = await fetch("/api/admin/gsc-property", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey, propertyUrl: selected }),
    });
    const body = await res.json();
    setMessage(body.message ?? (body.ok ? "Saved." : "Couldn't save."));
    setBusy(false);
  };

  if (!data) {
    return (
      <div className="card">
        <h2>Google Search Console</h2>
        <p className="meta">{message || "Checking the Google connection…"}</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Google Search Console</h2>
      {data.connected ? (
        <p className="meta">
          Connected{data.email ? ` as ${data.email}` : ""} — properties come straight from that account&apos;s
          Search Console list.{" "}
          <button className="btn" onClick={disconnect} disabled={busy} style={{ marginLeft: 8 }}>
            Disconnect
          </button>
        </p>
      ) : (
        <>
          <p className="section-desc">
            Sign in with the agency Google account to read Search Console directly — no more adding the
            service-account email to each client&apos;s property.
          </p>
          {data.configured ? (
            <a className="btn" href="/api/google/connect">
              Sign in with Google
            </a>
          ) : (
            <p className="meta">
              Needs a one-time setup: create an OAuth client in the Google Cloud project and set
              GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET in Railway.
            </p>
          )}
        </>
      )}

      {clientKey && (
        <div style={{ marginTop: 12 }}>
          <p className="section-desc" style={{ marginBottom: 6 }}>
            This client reads from: <code>{data.currentProperty ?? "not set"}</code>
          </p>
          {data.properties.length > 0 ? (
            <>
              <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ maxWidth: 420 }}>
                <option value="">Choose a property…</option>
                {!data.properties.some((p) => p.siteUrl === data.currentProperty) && data.currentProperty && (
                  <option value={data.currentProperty}>{data.currentProperty} (current)</option>
                )}
                {data.properties.map((p) => (
                  <option key={p.siteUrl} value={p.siteUrl}>
                    {p.siteUrl}
                  </option>
                ))}
              </select>{" "}
              <button className="btn" onClick={saveProperty} disabled={busy || !selected}>
                Use this property
              </button>
            </>
          ) : (
            <p className="meta">{data.propertiesError ?? "No properties visible to the current credentials yet."}</p>
          )}
        </div>
      )}

      {message && <p className="meta">{message}</p>}
    </div>
  );
}
