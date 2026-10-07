import { useState } from "react";
import { runConnectionCheck } from "../../lib/api/employee";

export default function ConnectionCheckButton() {
  const [status, setStatus] = useState<"idle" | "checking" | "ok">("idle");
  const [message, setMessage] = useState("");

  async function handleClick() {
    setStatus("checking");
    const result = await runConnectionCheck();
    if (result.ok) {
      setStatus("ok");
      setMessage("");
      setTimeout(() => setStatus("idle"), 2500);
    } else {
      setStatus("idle");
      setMessage(result.message);
    }
  }

  return (
    <>
      <button onClick={handleClick} disabled={status === "checking"}>
        {status === "checking" ? "Checking…" : status === "ok" ? "Connection healthy" : "Connection check"}
      </button>
      {message && <small role="status">{message}</small>}
    </>
  );
}