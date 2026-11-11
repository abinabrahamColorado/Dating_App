import type { NextConfig } from 'next';
import { securityHeaders } from './security-headers';
import { assertRuntimeSecurity } from '@meetwell/config/security';
const config: NextConfig = {
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  transpilePackages: ['@meetwell/config', '@meetwell/core', '@meetwell/db'],
  async headers() {
    return [
      {
        source: '/:path*',
        // Proxy supplies CSP on each request so Next's scripts receive its nonce.
        headers: securityHeaders(process.env.APP_MODE),
      },
    ];
  },
};
export default function configure(phase: string) {
  if (['phase-production-server', 'phase-development-server'].includes(phase))
    assertRuntimeSecurity(process.env, 'web');
  return config;
}
