import { useState } from "react";
import { ArrowRight, KeyRound, ChevronRight, Check, ShieldCheck } from "lucide-react";
import { signUp, startSsoSignIn, completeAuthRedirect } from "../../lib/api/auth";

interface SignUpFormProps {
  desktopCallback?: string;
}

export default function SignUpForm({ desktopCallback }: SignUpFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [desktopHandoff, setDesktopHandoff] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const form = new FormData(e.currentTarget);
    const result = await signUp({
      fullName: String(form.get("fullName") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    if (result.ok) {
      if (result.isDesktopRedirect) setDesktopHandoff(true);
      completeAuthRedirect(result);
    } else {
      alert(`Sign up failed: ${result.error}`);
      setSubmitting(false);
    }
  }

  async function handleSso() {
    const result = await startSsoSignIn();
    if (result.ok) completeAuthRedirect(result);
  }

  if (desktopHandoff) {
    return (
      <div className="auth-card">
        <div className="auth-card-head">
          <h2>Signed in</h2>
          <p>Signed in. Feel free to close this window and return to the Obrenna desktop app.</p>
        </div>
      </div>
    );
  }

  return (
    <form className="auth-card" onSubmit={handleSubmit}>
      <div className="auth-card-head">
        <h2>Create account</h2>
        <p>Use your work email to continue.</p>
      </div>
      <label>
        Full name
        <input name="fullName" placeholder="Your name" required />
      </label>
      <label>
        Work email
        <input name="email" placeholder="name@company.com" type="email" required />
      </label>
      <label>
        Password
        <div className="password-field">
          <input name="password" placeholder="••••••••••••" type="password" required minLength={12} />
        </div>
      </label>
      <div className="password-rules">
        <span className="valid"><Check size={12} /> 12+ characters</span>
        <span><Check size={12} /> One number or symbol</span>
      </div>
      <button className="button full-button" type="submit" disabled={submitting}>
        {submitting ? "Creating account…" : "Continue"} <ArrowRight size={16} />
      </button>
      <div className="auth-divider">
        <span>or continue with SSO</span>
      </div>
      <button className="sso-button" type="button" onClick={handleSso}>
        <KeyRound size={16} /> Organization SSO <ChevronRight size={16} />
      </button>
      <p className="auth-switch">
        Already have an account? <a href={desktopCallback ? `/sign-in?desktop_callback=${encodeURIComponent(desktopCallback)}` : "/sign-in"}>Sign in</a>
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
