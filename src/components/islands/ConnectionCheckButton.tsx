import { useState } from "react";
import { runConnectionCheck } from "../../lib/api/employee";

export default function ConnectionCheckButton() {
  const [status, setStatus] = useState<"idle" | "checking" | "ok">("idle");

  async function handleClick() {
    setStatus("checking");
    const result = await runConnectionCheck();
    setStatus(result.ok ? "ok" : "idle");
    if (result.ok) setTimeout(() => setStatus("idle"), 2500);
  }

  return (
    <button onClick={handleClick} disabled={status === "checking"}>
      {status === "checking" ? "Checking…" : status === "ok" ? "Connection healthy" : "Connection check"}
    </button>
  );
}
