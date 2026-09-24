import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { homeFor, useAuth } from "../lib/auth";
import { Banner, Button, Card, Field, Input } from "../components/ui";

export const DEMO_PASSWORD = "TaskNest!2026";
export const DEMO_ACCOUNTS = [
  { email: "ava@tasknest.test", role: "Client", note: "" },
  { email: "ben@tasknest.test", role: "Client", note: "" },
  { email: "tara@tasknest.test", role: "Tasker", note: "Handyman · $45/h · active" },
  { email: "leo@tasknest.test", role: "Tasker", note: "Cleaning · $38/h · active" },
  { email: "pia@tasknest.test", role: "Tasker", note: "Moving · $60/h · pending KYC" },
  { email: "admin@tasknest.test", role: "Admin", note: "" },
  { email: "agent@tasknest.test", role: "Support agent", note: "" },
];

export default function SignIn() {
  const { session, profile, signIn } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (session && profile) return <Navigate to={homeFor(profile.role)} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const p = await signIn(email.trim(), password);
      nav(homeFor(p?.role), { replace: true });
    } catch (err) {
      setError((err as Error).message || "Sign in failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
      <Card>
        <h1 className="mb-1 text-2xl font-semibold text-slate-900">Sign in to TaskNest</h1>
        <p className="mb-5 text-sm text-slate-500">Book trusted help for everyday tasks.</p>
        {error && (
          <Banner tone="error" testId="signin-error">
            {error}
          </Banner>
        )}
        <form onSubmit={submit}>
          <Field label="Email" id="email">
            <Input
              id="email"
              data-testid="signin-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Password" id="password">
            <Input
              id="password"
              data-testid="signin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <Button
            data-testid="signin-submit"
            type="submit"
            className="mt-2 w-full"
            disabled={pending}
          >
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>
      <Card data-testid="demo-accounts">
        <h2 className="mb-1 font-semibold text-slate-900">Demo accounts</h2>
        <p className="mb-3 text-sm text-slate-500">
          Test environment only. Password for all:{" "}
          <code className="rounded bg-slate-100 px-1">{DEMO_PASSWORD}</code>
        </p>
        <ul className="divide-y divide-slate-100">
          {DEMO_ACCOUNTS.map((a) => (
            <li key={a.email} className="flex items-center justify-between py-2">
              <div>
                <div className="text-sm font-medium text-slate-800">{a.email}</div>
                <div className="text-xs text-slate-500">
                  {a.role}
                  {a.note && ` · ${a.note}`}
                </div>
              </div>
              <Button
                variant="secondary"
                data-testid={`demo-${a.email.split("@")[0]}`}
                onClick={() => {
                  setEmail(a.email);
                  setPassword(DEMO_PASSWORD);
                }}
              >
                Use
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
