/** Spec P22. Nonces must be generated in Proxy, never at build time. */
export function contentSecurityPolicy(nonce: string, development = false, local = false) {
  if (!/^[A-Za-z0-9+/]{22,}={0,2}$/.test(nonce)) throw new Error('Invalid CSP nonce');
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    "script-src-attr 'none'",
    // React uses inline style properties; scripts still require a per-request nonce.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(!local ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}
export function securityHeaders(mode: string | undefined) {
  return [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'Permissions-Policy', value: 'geolocation=(), camera=(), microphone=()' },
    ...(mode !== 'local' ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }] : []),
  ];
}
