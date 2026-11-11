export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertRuntimeSecurity } = await import('@meetwell/config/security');
    const { operationalEvent } = await import('@meetwell/runtime/monitoring');
    assertRuntimeSecurity(process.env, 'web');
    operationalEvent('web.started');
  }
}
// Deliberately accept no request/error/context argument: none may enter telemetry.
export async function onRequestError() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { operationalEvent } = await import('@meetwell/runtime/monitoring');
    operationalEvent('web.request.failed');
  }
}
