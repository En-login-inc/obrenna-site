import { useState } from "react";
import { ArrowRight, KeyRound, ChevronRight, ShieldCheck } from "lucide-react";
import { signIn, startSsoSignIn, completeAuthRedirect } from "../../lib/api/auth";
import { DesktopHandoff } from "./DesktopHandoff";

interface SignInFormProps {
  desktopCallback?: string;
  currentUser?: {
    fullName: string;
    email: string;
  };
}

export default function SignInForm({ desktopCallback, currentUser }: SignInFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [desktopHandoff, setDesktopHandoff] = useState(false);
  const [useDifferentAccount, setUseDifferentAccount] = useState(!currentUser);

  async function handleDifferentAccount() {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
    setUseDifferentAccount(true);
  }

  function handoffCurrentAccount(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    const callbackUrl = event.currentTarget.href;
    setDesktopHandoff(true);
    window.setTimeout(() => {
      window.location.href = callbackUrl;
    }, 100);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const form = new FormData(e.currentTarget);
    const result = await signIn({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    if (result.ok) {
      if (result.isDesktopRedirect) setDesktopHandoff(true);
      completeAuthRedirect(result);
    } else {
      alert(`Sign in failed: ${result.error}`);
      setSubmitting(false);
    }
  }

  async function handleSso() {
    const result = await startSsoSignIn();
    if (result.ok) completeAuthRedirect(result);
  }

  if (desktopHandoff) {
    return <DesktopHandoff />;
  }

  if (desktopCallback && currentUser && !useDifferentAccount) {
    const callbackUrl = `/api/auth/desktop-callback?desktop_callback=${encodeURIComponent(desktopCallback)}`;
    return (
      <div className="auth-card">
        <div className="auth-card-head">
          <h2>Continue as {currentUser.fullName}</h2>
          <p>{currentUser.email} is already signed in on this browser.</p>
        </div>
        <a className="button full-button" href={callbackUrl} onClick={handoffCurrentAccount}>Use this account <ArrowRight size={16} /></a>
        <button className="sso-button" type="button" onClick={handleDifferentAccount}>
          Use a different account <ChevronRight size={16} />
        </button>
      </div>
    );
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
        New to Obrenna? <a href={desktopCallback ? `/sign-up?desktop_callback=${encodeURIComponent(desktopCallback)}` : "/sign-up"}>Create account</a>
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
