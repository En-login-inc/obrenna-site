import { useState } from "react";
import { ArrowRight, Check, ShieldCheck, X } from "lucide-react";
import { signUp, completeAuthRedirect } from "../../lib/api/auth";
import { DesktopHandoff } from "./DesktopHandoff";

interface SignUpFormProps {
  desktopCallback?: string;
}

const HAS_LENGTH = (value: string) => value.length >= 12;
const HAS_NUMBER_OR_SYMBOL = (value: string) => /[0-9]|[^A-Za-z0-9]/.test(value);

function isPasswordValid(value: string) {
  return HAS_LENGTH(value) && HAS_NUMBER_OR_SYMBOL(value);
}

export default function SignUpForm({ desktopCallback }: SignUpFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [desktopHandoff, setDesktopHandoff] = useState(false);
  const [password, setPassword] = useState("");

  const hasLength = HAS_LENGTH(password);
  const hasNumberOrSymbol = HAS_NUMBER_OR_SYMBOL(password);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isPasswordValid(password)) return;
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

  if (desktopHandoff) {
    return <DesktopHandoff />;
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
          <input
            name="password"
            placeholder="••••••••••••"
            type="password"
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="password-rules"
          />
        </div>
      </label>
      <div className="password-rules" id="password-rules">
        <span className={hasLength ? "valid" : ""}>
          {hasLength ? <Check size={12} /> : <X size={12} />} 12+ characters
        </span>
        <span className={hasNumberOrSymbol ? "valid" : ""}>
          {hasNumberOrSymbol ? <Check size={12} /> : <X size={12} />} One number or symbol
        </span>
      </div>
      <button className="button full-button" type="submit" disabled={submitting || !isPasswordValid(password)}>
        {submitting ? "Creating account…" : "Continue"} <ArrowRight size={16} />
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
