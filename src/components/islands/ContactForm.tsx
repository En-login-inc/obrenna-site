import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { submitContactRequest } from "../../lib/api/contact";

export default function ContactForm() {
  const [status, setStatus] = useState<"idle" | "submitting" | "sent">("idle");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");
    const form = new FormData(e.currentTarget);
    await submitContactRequest({
      workEmail: String(form.get("workEmail") ?? ""),
      firstName: String(form.get("firstName") ?? ""),
      lastName: String(form.get("lastName") ?? ""),
      organization: String(form.get("organization") ?? ""),
      teamSize: String(form.get("teamSize") ?? ""),
      message: String(form.get("message") ?? ""),
    });
    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <div className="contact-form">
        <div className="form-heading">
          <h2>Request received</h2>
          <p>We'll reply to your work email within one business day.</p>
        </div>
      </div>
    );
  }

  return (
    <form className="contact-form" onSubmit={handleSubmit}>
      <div className="form-heading">
        <h2>Request a conversation</h2>
        <p>We'll reply within one business day.</p>
      </div>
      <label>
        Work email
        <input name="workEmail" placeholder="you@company.com" type="email" required />
      </label>
      <div className="two-fields">
        <label>
          First name
          <input name="firstName" placeholder="Darian" required />
        </label>
        <label>
          Last name
          <input name="lastName" placeholder="Last name" required />
        </label>
      </div>
      <label>
        Organization
        <input name="organization" placeholder="Company or institution" required />
      </label>
      <label>
        Team size
        <select name="teamSize" defaultValue="" required>
          <option value="" disabled>Select employee count</option>
          <option>1–25</option>
          <option>26–100</option>
          <option>101–500</option>
          <option>500+</option>
        </select>
      </label>
      <label>
        What are you looking to deploy?
        <textarea
          name="message"
          placeholder="Tell us about your private AI goals, infrastructure and timeline."
          rows={4}
        />
      </label>
      <button className="button full-button" type="submit" disabled={status === "submitting"}>
        {status === "submitting" ? "Sending…" : "Request meeting"} <ArrowRight size={16} />
      </button>
      <small>By submitting, you agree that Obrenna may contact you about this request.</small>
    </form>
  );
}
