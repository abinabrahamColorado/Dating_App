import { safetyConfig } from '@meetwell/config/safety';
import { clientVersionSchema, isSafetyAssistanceRoute } from '@meetwell/core/safety';
import { AccountStore, StoreError } from './accounts';

/** Spec P20. A release shutdown is not a substitute for identity authorization.
 * Checking the server's build as well prevents header edits bypassing its shutdown. */
export async function requireSupportedClient(
  store: AccountStore,
  route: string,
  method: string,
  suppliedVersion: string | null,
) {
  if (isSafetyAssistanceRoute(route, method)) return;
  const version = clientVersionSchema.parse(suppliedVersion ?? safetyConfig.CLIENT_VERSION);
  const result = await store.app.query<{ disabled: boolean }>(
    'SELECT app.client_version_disabled($1) OR app.client_version_disabled($2) AS disabled',
    [version, safetyConfig.CLIENT_VERSION],
  );
  if (result.rows[0]!.disabled) throw new StoreError('CLIENT_VERSION_DISABLED');
}
