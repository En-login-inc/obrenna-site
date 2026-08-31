import { useState } from "react";
import { ArrowRight, KeyRound, ChevronRight, ShieldCheck } from "lucide-react";
import { signIn, startSsoSignIn } from "../../lib/api/auth";

export default function SignInForm() {
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const form = new FormData(e.currentTarget);
    const result = await signIn({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    if (result.ok) {
      window.location.href = result.redirectTo;
    } else {
      alert(`Sign in failed: ${result.error}`);
      setSubmitting(false);
    }
  }

  async function handleSso() {
    const result = await startSsoSignIn();
    if (result.ok) window.location.href = result.redirectTo;
  }

  return (
    <form className="auth-card" onSubmit={handleSubmit}>
      <div className="auth-card-head">
        <h2>Sign in to Obrenna</h2>
        <p>Use your organization credentials.</p>
      </div>
      <label>
        Work email
        <input name="email" placeholder="name@company.com" type="email" required />
      </label>
      <label>
        Password
        <div className="password-field">
          <input name="password" placeholder="••••••••••••" type="password" required />
          <a href="#">Forgot password?</a>
        </div>
      </label>
      <button className="button full-button" type="submit" disabled={submitting}>
        {submitting ? "Signing in…" : "Sign in"} <ArrowRight size={16} />
      </button>
      <div className="auth-divider">
        <span>or continue with SSO</span>
      </div>
      <button className="sso-button" type="button" onClick={handleSso}>
        <KeyRound size={16} /> Organization SSO <ChevronRight size={16} />
      </button>
      <p className="auth-switch">
        New to Obrenna? <a href="/sign-up">Create account</a>
      </p>
      <div className="auth-security">
        <ShieldCheck size={14} /> Protected with encrypted sessions and optional MFA.
      </div>
    
      <div className="auth-footer">
        <span>Privacy</span>
        <span>Security</span>
        <span>Documentation</span>
        <span>© 2026 Obrenna</span>
      </div>
    </form>
  );
}
