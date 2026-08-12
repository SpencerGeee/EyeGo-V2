'use client';

import { useState } from 'react';

import { Icon } from '@/components/ui/Icon';

/**
 * Follows the form rules the rest of the console does: visible labels (not
 * placeholder-only), semantic input types so mobile keyboards are right,
 * autocomplete attributes so password managers work, the error stated next to
 * the fields with a recovery path, and a submit button that disables while in
 * flight so a double submit cannot burn two of the API's 20 attempts.
 */
export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    setError(null);
    setBusy(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok || !body?.ok) {
        setError(body?.message || 'Sign-in failed. Check your details and try again.');
        setBusy(false);
        return;
      }

      // A hard navigation, not router.push: the layout must re-run on the server
      // with the new cookies, and a client push would reuse the cached
      // unauthenticated tree.
      window.location.href = body.mustChangePassword ? '/change-password' : next;
    } catch {
      setError('Could not reach the console server. Check your connection and try again.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      {error ? (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-2 p-3 mb-4 rounded-md bg-danger-soft border border-danger-rim"
        >
          <Icon name="alert" size={14} className="text-danger mt-0.5" />
          <p className="t-small text-danger">{error}</p>
        </div>
      ) : null}

      <div className="mb-4">
        <label className="label" htmlFor="email">
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          autoFocus
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error ? true : undefined}
        />
      </div>

      <div className="mb-5">
        <label className="label" htmlFor="password">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            className="input !pr-10"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
          />
          <button
            type="button"
            className="absolute right-1 top-1/2 -translate-y-1/2 btn btn-ghost btn-icon btn-sm"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            tabIndex={-1}
          >
            <Icon name={showPassword ? 'ban' : 'eye'} size={14} />
          </button>
        </div>
      </div>

      <button type="submit" className="btn btn-primary btn-lg w-full" disabled={busy} aria-busy={busy}>
        {busy ? <Icon name="refresh" size={15} className="spin" /> : null}
        {busy ? 'Signing in…' : 'Sign in'}
      </button>

      <p className="hint mt-4">
        Locked out after five failed attempts for 15 minutes. A superadmin can
        reset your password from Admin accounts.
      </p>
    </form>
  );
}
