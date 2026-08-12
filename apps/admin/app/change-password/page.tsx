import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getAdmin } from '@/lib/api';

import { ChangePasswordForm } from './ChangePasswordForm';

export const metadata: Metadata = { title: 'Set a new password' };

/**
 * The forced-rotation gate.
 *
 * A seeded or reset account carries mustChangePassword, and the console layout
 * redirects here until it is cleared. This page deliberately sits OUTSIDE the
 * console shell: there is no sidebar to wander off into, because the whole point
 * is that this account cannot be used on a password someone else chose for it.
 */
export default async function ChangePasswordPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/login?reason=session');

  // Someone who has already rotated does not need to be here.
  if (!admin.mustChangePassword) redirect('/settings');

  return (
    <main className="min-h-dvh grid place-items-center p-6">
      <div className="w-full max-w-[420px]">
        <div className="flex items-center gap-2.5 mb-7">
          <span className="w-7 h-7 rounded-md bg-accent text-[color:var(--on-accent)] grid place-items-center font-bold text-sm">
            E
          </span>
          <div className="t-heading">EyeGo Console</div>
        </div>

        <h1 className="t-title">Set your own password</h1>
        <p className="t-small text-text-dim mt-1.5 mb-6">
          You are signed in as <strong className="text-text">{admin.email}</strong> with a password
          that was issued to you. Choose your own before continuing — every action in the console is
          recorded against this account.
        </p>

        <ChangePasswordForm forced />
      </div>
    </main>
  );
}
