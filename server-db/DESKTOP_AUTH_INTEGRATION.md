# Desktop ↔ site authorization

The website is authoritative for user, organization, membership, machine, and model-access policy. The desktop keeps conversations and artifacts locally and obtains short-lived, signed inference grants from the site. The inference gateway validates those grants and applies the organization’s model policy.

## Desktop sign-in

The desktop creates a cryptographically random PKCE verifier and state value, derives an S256 challenge, and opens the configured site sign-in page with `desktop_callback=obrenna://auth`, `code_challenge`, `code_challenge_method=S256`, and `state`. The website authenticates through its normal secure, HttpOnly session cookie. After sign-in, it issues a random, single-use authorization code valid for two minutes and redirects to the registered `obrenna://auth` callback with only `code` and `state`.

The desktop verifies the returned state and exchanges the code, verifier, and device identity through the native backend at `POST /api/auth/desktop-exchange`. The site validates PKCE, consumes the code once, and returns the session and current organization identity. The native desktop stores credentials in the OS credential vault; credentials must not be placed in URLs, browser local storage, logs, or frontend preferences.

## Inference grants and policy refresh

The native desktop requests `POST /api/auth/inference-grant` using its authenticated session and registered device. The website verifies the active user, organization membership, device, and assigned machine/model pairs before signing a grant. Grants use RS256, identify the configured issuer and `obrenna-inference` audience, include organization, user, device, policy revision, assignment set, issue/expiry times, and a unique grant ID, and expire within 24 hours. The public verification key is published at `/.well-known/jwks.json`.

While connected, the desktop refreshes grant status and policy/revocation information at least every 60 seconds. A known suspension, revocation, or policy denial overrides a cached grant. Network loss does not extend a grant; previously authorized work may continue only until its signed expiry. Offline use cannot enroll a device or expand permissions. The local desktop can still operate independently without organization inference, but must not silently bypass organization policy.

The desktop keeps its organization-required mode as a separate durable OS-vault marker, so signing out or restarting the sidecar cannot turn an enrolled machine into a direct-model client. If the website session expires while the signed inference grant remains valid, the desktop checks that grant through `POST /api/auth/inference-grant-status`; a confirmed active grant remains usable through its original expiry, while a confirmed denial clears it. If the website cannot answer, the existing grant may be used only until that same expiry.

Suspending an organization membership marks its enrolled desktop devices `suspended`, which immediately invalidates grants through the membership/device status check. Reactivation does not make those devices active by itself; the desktop must complete a fresh PKCE exchange. That exchange can reactivate only a device row suspended with the membership, so an independently revoked device cannot be silently enrolled again.

## Configuration

Set `SITE_PUBLIC_ORIGIN` to the one canonical deployment origin. Production requires HTTPS. Configure `INFERENCE_GRANT_KEY_ID` and `INFERENCE_GRANT_PRIVATE_KEY` from the deployment secret store; never commit the private key. The corresponding endpoint publishes public verification material only. Rotate keys by publishing the new `kid` before issuing grants with it and retaining old public keys until all grants signed by the old key have expired. Supply the retained public RSA keys as a JSON array in `INFERENCE_GRANT_PREVIOUS_PUBLIC_KEYS` (maximum 16 keys and 64 KiB); each entry needs only `kid`, `kty`, `n`, and `e`. Keep each entry until the old key's final grant is beyond its 24-hour expiry, then remove it.

The site also requires `AUTH_DB_URL` for PostgreSQL identity and policy records. See [the setup and verification guide](./AUTH_SETUP_TESTING.md). Do not use a locally selected desktop role or client-supplied organization ID as authorization evidence.

## Failure behavior

- Invalid, expired, replayed, or mismatched PKCE authorization codes fail closed.
- Inactive users, organizations, memberships, devices, or model assignments cannot receive a grant.
- Grant signing fails closed when the canonical issuer or signing-key configuration is missing.
- A known revocation or stale policy revision denies access even if the grant has not expired.
- An unavailable website may prevent new grants or policy expansion. A valid cached grant remains bounded by its original expiry.

## Verification

Run `npm run test:auth` for grant-signing and policy-contract tests. Build and type-check with `npm run build`. Exercise the full callback, code exchange, credential-vault storage, policy refresh, and revocation path in a packaged Windows desktop environment before enabling organization inference in production.
