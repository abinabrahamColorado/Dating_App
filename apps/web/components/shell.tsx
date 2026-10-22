import Link from 'next/link';
import type { ReactNode } from 'react';
export function Shell({ children, member = false }: { children: ReactNode; member?: boolean }) {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <Link href="/" className="wordmark" aria-label="Meetwell home">
          meetwell<span aria-hidden="true">✳</span>
        </Link>
        <nav aria-label="Main navigation">
          {member ? (
            <>
              <Link href="/app">My profile</Link>
              <Link href="/explore">Introductions</Link>
              <Link href="/settings">Settings</Link>
              <Link href="/safety/cases">My reports</Link>
            </>
          ) : (
            <>
              <Link href="/how-it-works">How it works</Link>
              <Link href="/safety">Safety</Link>
              <Link href="/signin">Sign in</Link>
              <Link className="button small" href="/apply">
                Get started <span aria-hidden="true">↗</span>
              </Link>
            </>
          )}
        </nav>
      </header>
      <main id="main">{children}</main>
      <footer className="site-footer">
        <span className="wordmark">
          meetwell<span aria-hidden="true">✳</span>
        </span>
        <p>A little more intention. A little less noise.</p>
        <nav aria-label="Footer">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/safety">Safety & choice</Link>
        </nav>
        <small>Private development preview · Meetwell is a working name.</small>
      </footer>
    </>
  );
}
