"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json()) as { ok: boolean; message: string };
      if (data.ok) {
        router.push(searchParams.get("next") || "/");
        router.refresh();
      } else {
        setError(data.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card login-card">
      <h1>SEO Reporting</h1>
      <p className="subtitle">Team access</p>
      <label className="chips-label">
        Password
        <input
          type="password"
          className="login-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
      </label>
      <button className="btn primary" type="submit" disabled={busy} style={{ marginTop: 12 }}>
        {busy ? "Checking…" : "Sign in"}
      </button>
      {error && <p className="action-msg error">{error}</p>}
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="container" style={{ maxWidth: 420, paddingTop: 80 }}>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
