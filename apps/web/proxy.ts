import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { contentSecurityPolicy, securityHeaders } from './security-headers';
export function proxy(request: NextRequest) {
  const nonce = randomBytes(32).toString('base64');
  const policy = contentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === 'development',
    process.env.APP_MODE === 'local',
  );
  const headers = new Headers(request.headers);
  // Incoming values are untrusted; Next extracts the trusted nonce from this CSP.
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', policy);
  response.headers.set('Cache-Control', 'private, no-store');
  for (const { key, value } of securityHeaders(process.env.APP_MODE))
    response.headers.set(key, value);
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
