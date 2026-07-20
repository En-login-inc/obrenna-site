import { useState } from "react";
import { Copy, Check } from "lucide-react";

export default function CopyCodeButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API unavailable (e.g. insecure context); nothing to fall back to.
    }
  }

  return (
    <button onClick={handleCopy} type="button">
      {copied ? <Check size={15} /> : <Copy size={15} />}
      {label ? <span>{copied ? "Copied" : label}</span> : null}
    </button>
  );
}
