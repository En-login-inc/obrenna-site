import { useState } from "react";
import { ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import { createOrganization } from "../../lib/api/organization";

interface CreateOrganizationFormProps {
  desktopCallback?: string;
}

export default function CreateOrganizationForm({ desktopCallback }: CreateOrganizationFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("Northstar Labs");
  const [slug, setSlug] = useState("northstar-labs");
  const [region, setRegion] = useState<"Canada" | "United States" | "European Union">("Canada");
  const [orgType, setOrgType] = useState<"Business" | "Education" | "Government" | "Non-profit">("Business");

  async function handleCreate() {
    setSubmitting(true);
    const result = await createOrganization({ name, identifier: slug, region, orgType });
    if (result.ok) {
      window.location.href = desktopCallback
        ? `/api/auth/desktop-callback?desktop_callback=${encodeURIComponent(desktopCallback)}`
        : "/portal/admin";
    } else {
      setSubmitting(false);
      alert(result.error || "Could not create organization");
    }
  }

  return (
    <>
      <div className="setup-card">
        <div className="logo-upload">
          <span>NS</span>
          <div>
            <b>Organization logo</b>
            <small>PNG, JPG or SVG · max 2 MB</small>
          </div>
          <button type="button">Upload</button>
        </div>
        <label>
          Organization name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Organization identifier
          <div className="slug-field">
            <span>obrenna.com/</span>
            <input value={slug} onChange={(e) => setSlug(e.target.value)} />
            <CheckCircle2 size={16} />
          </div>
          <small>Used in enrollment and sign-in. This can't be changed later.</small>
        </label>
        <div className="two-fields">
          <label>
            Primary region
            <select value={region} onChange={(e) => setRegion(e.target.value as typeof region)}>
              <option>Canada</option>
              <option>United States</option>
              <option>European Union</option>
            </select>
          </label>
          <label>
            Organization type
            <select value={orgType} onChange={(e) => setOrgType(e.target.value as typeof orgType)}>
              <option>Business</option>
              <option>Education</option>
              <option>Government</option>
              <option>Non-profit</option>
            </select>
          </label>
        </div>
        <div className="setup-boundary">
          <ShieldCheck size={18} />
          <div>
            <b>Your region applies to control-plane metadata only.</b>
            <p>Private prompts, files and model workloads remain on the organization infrastructure you enroll.</p>
            <a href="/privacy">Learn more</a>
          </div>
        </div>
      </div>
      <div className="setup-actions">
        <a href="/">Cancel setup</a>
        <button className="button" onClick={handleCreate} disabled={submitting}>
          {submitting ? "Creating…" : "Create organization"} <ArrowRight size={16} />
        </button>
      </div>
    </>
  );
}
