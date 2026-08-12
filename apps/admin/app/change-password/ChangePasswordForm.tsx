'use client';

import { useState } from 'react';

import { Icon } from '@/components/ui/Icon';
import { changeOwnPassword } from '@/lib/actions';

/**
 * Password change, used by both the forced-rotation page and Settings.
 *
 * Validation runs on blur, not on every keystroke — telling someone their
 * password is too short while they are still on the fourth character is noise
 * they learn to ignore. The strength requirements are stated up front as
 * persistent helper text rather than only appearing as an error.
 */
export function ChangePasswordForm({ forced }: { forced?: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rules = [
    { ok: next.length >= 12, text: 'At least 12 characters' },
    { ok: /[a-z]/.test(next) && /[A-Z]/.test(next), text: 'Upper and lower case' },
    { ok: /[0-9]/.test(next), text: 'At least one digit' },
    { ok: next.length > 0 && next !== current, text: 'Different from your current password' },
  ];

  const allRulesOk = rules.every((r) => r.ok);
  const mismatch = touched.confirm && confirm.length > 0 && confirm !== next;
  const canSubmit = current.length > 0 && allRulesOk && confirm === next && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setError(null);
    setBusy(true);

    const result = await changeOwnPassword(current, next);

    if (!result.ok) {
      setError(result.message);
      setBusy(false);
      return;
    }

    // The API revokes every session on a password change, including this one, so
    // there is nothing to return to — a hard navigation to login is correct.
    window.location.href = '/login?reason=changed';
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
        <label className="label" htmlFor="current">
          Current password
        </label>
        <input
          id="current"
          type="password"
          autoComplete="current-password"
          className="input"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
      </div>

      <div className="mb-4">
        <label className="label" htmlFor="next">
          New password
        </label>
        <div className="relative">
          <input
            id="next"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            className="input !pr-10"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, next: true }))}
            aria-describedby="pw-rules"
            required
          />
          <button
            type="button"
            className="absolute right-1 top-1/2 -translate-y-1/2 btn btn-ghost btn-icon btn-sm"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? 'Hide password' : 'Show password'}
            tabIndex={-1}
          >
            <Icon name={show ? 'ban' : 'eye'} size={14} />
          </button>
        </div>

        <ul id="pw-rules" className="mt-2.5 space-y-1">
          {rules.map((r) => (
            <li
              key={r.text}
              className={`t-small flex items-center gap-1.5 ${
                r.ok ? 'text-accent' : 'text-text-faint'
              }`}
            >
              <Icon name={r.ok ? 'check' : 'x'} size={11} />
              {r.text}
            </li>
          ))}
        </ul>
      </div>

      <div className="mb-5">
        <label className="label" htmlFor="confirm">
          Confirm new password
        </label>
        <input
          id="confirm"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          className="input"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
          aria-invalid={mismatch || undefined}
          aria-describedby={mismatch ? 'confirm-error' : undefined}
          required
        />
        {mismatch ? (
          <p id="confirm-error" className="error-text" role="alert">
            <Icon name="alert" size={11} />
            These do not match.
          </p>
        ) : null}
      </div>

      <button type="submit" className="btn btn-primary btn-lg w-full" disabled={!canSubmit} aria-busy={busy}>
        {busy ? <Icon name="refresh" size={15} className="spin" /> : null}
        {busy ? 'Saving…' : forced ? 'Set password and continue' : 'Change password'}
      </button>

      <p className="hint mt-3">
        Changing your password signs out every device, including this one. You will
        be asked to sign in again.
      </p>
    </form>
  );
}
