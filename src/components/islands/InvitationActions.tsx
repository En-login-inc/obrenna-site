import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { acceptInvitation, declineInvitation } from "../../lib/api/organization";

export default function InvitationActions({ token }: { token: string }) {
  const [submitting, setSubmitting] = useState(false);

  async function handleAccept() {
    setSubmitting(true);
    const result = await acceptInvitation(token);
    if (result.ok) window.location.href = "/portal/employee";
  }

  async function handleDecline() {
    setSubmitting(true);
    await declineInvitation(token);
    window.location.href = "/";
  }

  return (
    <>
      <button className="button full-button" onClick={handleAccept} disabled={submitting}>
        Accept and join Northstar Labs <ArrowRight size={16} />
      </button>
      <button className="reject-button" onClick={handleDecline} disabled={submitting}>
        Decline invitation
      </button>
    </>
  );
}
