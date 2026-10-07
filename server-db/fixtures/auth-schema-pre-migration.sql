INSERT INTO users (id, email, full_name, password_hash)
VALUES ('11111111-1111-4111-8111-111111111111', 'migration-fixture@example.test', 'Migration Fixture', 'unused');

INSERT INTO organizations (id, name, slug)
VALUES ('22222222-2222-4222-8222-222222222222', 'Fixture Org', 'fixture-org');

INSERT INTO organization_memberships (user_id, organization_id, role)
VALUES ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'admin');

INSERT INTO desktop_auth_devices (id, organization_id, user_id, device_name, device_key, status)
VALUES (
    '33333333-3333-4333-8333-333333333333',
    '22222222-2222-4222-8222-222222222222',
    '11111111-1111-4111-8111-111111111111',
    'Fixture Desktop',
    'fixture-key',
    'active'
);
