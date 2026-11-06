-- Organization-wide switch for the desktop app's Code mode. Only an explicit false turns it off;
-- the signed inference grant carries it as the `code_mode` claim.
ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS code_mode_enabled BOOLEAN NOT NULL DEFAULT TRUE;
