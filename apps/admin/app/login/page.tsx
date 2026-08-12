import type { Metadata } from 'next';

import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Sign in' };

const REASONS: Record<string, string> = {
  expired: 'Your session expired. Sign in again to continue.',
  session: 'That session is no longer valid. Sign in again.',
  changed: 'Your password changed, so every session was signed out. Sign in with the new one.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const { next, reason } = await searchParams;

  // Only same-origin relative paths are honoured as a post-login destination.
  // Echoing an arbitrary `next` back into a redirect is an open-redirect that
  // turns the login page into a convincing phishing hop.
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  return (
    <main className="min-h-dvh grid lg:grid-cols-[1.05fr_1fr]">
      {/* Left: identity. Deliberately quiet — a login screen is not a place to
          demonstrate the whole design system. */}
      <section className="hidden lg:flex flex-col justify-between p-10 border-r border-line bg-surface relative overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute -top-24 -left-16 w-[420px] h-[420px] rounded-full opacity-[0.09] blur-3xl"
          style={{ background: 'var(--accent)' }}
        />
        <div className="flex items-center gap-2.5 relative">
          <span className="w-7 h-7 rounded-md bg-accent text-[color:var(--on-accent)] grid place-items-center font-bold text-sm">
            E
          </span>
          <div>
            <div className="t-heading leading-none">EyeGo</div>
            <div className="text-[10px] text-text-faint tracking-[0.09em] leading-none mt-0.5">
              OPERATIONS CONSOLE
            </div>
          </div>
        </div>

        <div className="relative max-w-[42ch]">
          <h2 className="t-display">Every action here is recorded.</h2>
          <p className="t-body text-text-dim mt-3">
            Console accounts are personal and scoped to a role. Dispatch, fleet
            approval, money and releases are separate powers, and each mutating
            action is written to an append-only audit log against your name.
          </p>
        </div>

        <p className="t-small text-text-faint relative">
          Ghana · GHS · All times UTC
        </p>
      </section>

      {/* Right: the form. */}
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-[380px]">
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <span className="w-7 h-7 rounded-md bg-accent text-[color:var(--on-accent)] grid place-items-center font-bold text-sm">
              E
            </span>
            <div className="t-heading">EyeGo Console</div>
          </div>

          <h1 className="t-title">Sign in</h1>
          <p className="t-small text-text-dim mt-1.5 mb-6">
            Use your personal console account.
          </p>

          {reason && REASONS[reason] ? (
            <div
              role="status"
              className="flex items-start gap-2 p-3 mb-5 rounded-md bg-warn-soft border border-warn-rim"
            >
              <p className="t-small text-warn">{REASONS[reason]}</p>
            </div>
          ) : null}

          <LoginForm next={safeNext} />
        </div>
      </section>
    </main>
  );
}
