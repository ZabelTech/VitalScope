import { useState } from "react";

interface Props {
  onSuccess: () => void;
}

export function LoginForm({ onSuccess }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        credentials: "same-origin",
      });
      if (res.status === 401) {
        setError("Wrong password");
        setSubmitting(false);
        return;
      }
      if (!res.ok) {
        setError(`Unexpected error (${res.status})`);
        setSubmitting(false);
        return;
      }
      onSuccess();
    } catch {
      setError("Network error");
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-form overview-card" onSubmit={handleSubmit}>
        <h1>VitalScope</h1>
        <p className="login-tagline">The State of You</p>
        <label className="journal-field">
          <span className="stat-label">Password</span>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="journal-err">{error}</p>}
        <div className="journal-actions">
          <button type="submit" disabled={submitting || !password}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}
