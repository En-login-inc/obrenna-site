import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { acceptInvitation, declineInvitation } from "../../lib/api/organization";

export default function InvitationActions({ token }: { token: string }) {
  const [submitting, setSubmitting] = useState<"none" | "accept" | "decline">("none");
  const [error, setError] = useState("");

  async function handleAccept() {
    setSubmitting("accept");
    const result = await acceptInvitation(token);
    if (result.ok) window.location.href = "/portal/employee";
    else { setError(result.message); setSubmitting("none"); }
  }

  async function handleDecline() {
    setSubmitting("decline");
    const result = await declineInvitation(token);
    if (result.ok) window.location.href = "/";
    else { setError(result.message); setSubmitting("none"); }
  }

  return (
    <>
      {error && <p className="admin-action-error" role="status">{error}</p>}
      <button className="button full-button" onClick={handleAccept} disabled={submitting !== "none"}>
        {submitting === "accept" ? "Joining…" : "Accept invitation"} <ArrowRight size={16} />
      </button>
      <button className="reject-button" onClick={handleDecline} disabled={submitting !== "none"}>
        {submitting === "decline" ? "Declining…" : "Decline invitation"}
      </button>
    </>
  );
}