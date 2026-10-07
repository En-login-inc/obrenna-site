export type MutationResult =
  | { ok: true; data?: unknown }
  | { ok: false; unavailable?: true; message: string };

export function unavailableMutation(capability: string): MutationResult {
  return {
    ok: false,
    unavailable: true,
    message: `${capability} is unavailable until the organization control-plane API is configured. No changes were made.`,
  };
}
