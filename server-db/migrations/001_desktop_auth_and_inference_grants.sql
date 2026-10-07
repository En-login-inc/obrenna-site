ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS policy_revision BIGINT NOT NULL DEFAULT 1;

-- One installation can be used by more than one employee account, but a
-- user's device remains stable within each organization.
ALTER TABLE desktop_auth_devices
    DROP CONSTRAINT IF EXISTS desktop_auth_devices_device_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_desktop_auth_devices_user_org_key
    ON desktop_auth_devices(user_id, organization_id, device_key);

CREATE TABLE IF NOT EXISTS desktop_authorization_codes (
    code_hash CHAR(64) PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
    code_challenge CHAR(43) NOT NULL,
    state VARCHAR(128) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_desktop_authorization_codes_expiry
    ON desktop_authorization_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_desktop_auth_devices_owner_status
    ON desktop_auth_devices(organization_id, user_id, status);

CREATE TABLE IF NOT EXISTS organization_inference_machines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, name),
    CHECK (status IN ('active', 'revoked'))
);

-- Access is granted per machine/model pair so a token cannot combine an
-- otherwise valid model with a different machine's endpoint.
CREATE TABLE IF NOT EXISTS organization_model_access (
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    machine_id UUID NOT NULL REFERENCES organization_inference_machines(id) ON DELETE CASCADE,
    model_id VARCHAR(200) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, machine_id, model_id),
    CHECK (status IN ('active', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_org_model_access_active
    ON organization_model_access(organization_id, machine_id, model_id) WHERE status = 'active';
