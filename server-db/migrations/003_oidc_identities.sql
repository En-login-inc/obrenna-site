-- Generic OIDC sign-in: federated identities and single-use authorization requests.
-- Numbered 003 to stay clear of the open code-mode-switch migration (002); the
-- runner applies files by name, so either merge order is safe.

CREATE TABLE IF NOT EXISTS user_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issuer VARCHAR(512) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (issuer, subject)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user
    ON user_identities(user_id);

CREATE TABLE IF NOT EXISTS oidc_auth_requests (
    state VARCHAR(128) PRIMARY KEY,
    payload JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oidc_auth_requests_expiry
    ON oidc_auth_requests(expires_at);