import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
// Request-specific CSP nonces cannot be cached in static HTML.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Meetwell — room for a real connection',
  description: 'Thoughtful local introductions, at a pace you choose.',
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
