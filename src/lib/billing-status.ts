/** Explicit responses for billing routes until a billing provider is configured. */
export function unavailableBillingPortal() {
  return Response.json(
    { ok: false, error: 'Billing portal is unavailable because billing is not configured' },
    { status: 501 },
  );
}

export function billingSyncStatus(enabled: boolean) {
  return Response.json({
    ok: true,
    sync: {
      enabled,
      status: 'unavailable',
      message: 'Billing sync is not configured',
    },
  });
}
