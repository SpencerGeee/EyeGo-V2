'use client';

import Image from 'next/image';
import { useState, useTransition } from 'react';

import { Icon } from '@/components/ui/Icon';
import { Badge, Card, CardBody, CardHead } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { beginTotpEnrolment, confirmTotpEnrolment, disableTotp } from '@/lib/actions';
import { dateTime } from '@/lib/format';

type Status = {
  enabled: boolean;
  enabledAt: string | null;
  backupCodesRemaining: number;
  requiredByPolicy: boolean;
};

/**
 * Two-factor enrolment.
 *
 * WHY IT MATTERS HERE. A console account can reprice every ride on the platform
 * and ban any user. Riders sign in with a one-time code; until now the
 * administrators had a weaker bar than their own customers.
 *
 * ENROLMENT IS TWO STEPS ON PURPOSE. Minting the secret does not switch MFA on
 * — a code generated from it has to come back first. Somebody who scans a
 * blurred QR, or scans nothing at all, is not locked out of the console by
 * having merely started.
 *
 * The QR is rendered by the API as a data URI, so the shared secret is never
 * handed to browser JavaScript to be drawn.
 */
export function TwoFactorPanel({ status }: { status: Status | null }) {
  const [step, setStep] = useState<'idle' | 'scan' | 'codes'>('idle');
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [disabling, setDisabling] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [pending, start] = useTransition();
  const toast = useToast();

  const enabled = status?.enabled ?? false;

  function begin() {
    start(async () => {
      const r = await beginTotpEnrolment();
      if (!r.ok) return toast.error(r.message);
      const data = r.data as { secret: string; qrDataUri: string | null };
      setSecret(data.secret);
      setQr(data.qrDataUri);
      setStep('scan');
    });
  }

  function confirm() {
    start(async () => {
      const r = await confirmTotpEnrolment(code);
      if (!r.ok) return toast.error(r.message);
      setBackupCodes((r.data as { backupCodes: string[] }).backupCodes ?? []);
      setCode('');
      setStep('codes');
      toast.success('Two-factor is on.');
    });
  }

  function turnOff() {
    start(async () => {
      const r = await disableTotp(disableCode);
      if (!r.ok) return toast.error(r.message);
      toast.success(r.message);
      setDisabling(false);
      setDisableCode('');
    });
  }

  return (
    <Card>
      <CardHead
        title="Two-factor authentication"
        icon="lock"
        actions={
          enabled ? (
            <Badge tone="accent" icon="check">
              On
            </Badge>
          ) : status?.requiredByPolicy ? (
            <Badge tone="danger" icon="alert">
              Required
            </Badge>
          ) : (
            <Badge tone="warn">Off</Badge>
          )
        }
      />
      <CardBody>
        {/* ── Already on ───────────────────────────────────────── */}
        {enabled && step !== 'codes' ? (
          <>
            <p className="t-small text-text-dim">
              Switched on {dateTime(status?.enabledAt ?? null)}. You will be asked
              for a code every time you sign in.
            </p>
            <p className="t-small mt-2">
              <strong>{status?.backupCodesRemaining ?? 0}</strong> recovery codes left.
              {(status?.backupCodesRemaining ?? 0) <= 2 ? (
                <span className="text-warn">
                  {' '}
                  Running low — switch two-factor off and on again to issue a fresh set.
                </span>
              ) : null}
            </p>

            {status?.requiredByPolicy ? (
              <p className="hint mt-3">
                Two-factor is required for every console account by platform
                policy, so it cannot be switched off here.
              </p>
            ) : !disabling ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm mt-4"
                onClick={() => setDisabling(true)}
              >
                Switch two-factor off
              </button>
            ) : (
              <div className="mt-4 flex flex-col gap-2 max-w-xs">
                <label className="label" htmlFor="disable-code">
                  Enter a current code to confirm
                </label>
                <input
                  id="disable-code"
                  className="input mono"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value)}
                  disabled={pending}
                />
                {/* Requiring a live code stops somebody who walks up to an
                    unlocked screen from quietly removing the second factor. */}
                <p className="hint">
                  A code from your app, or one of your recovery codes.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={turnOff}
                    disabled={pending || !disableCode.trim()}
                  >
                    {pending ? 'Working…' : 'Switch off'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setDisabling(false)}
                    disabled={pending}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        ) : null}

        {/* ── Not on yet ───────────────────────────────────────── */}
        {!enabled && step === 'idle' ? (
          <>
            <p className="t-small text-text-dim">
              An authenticator app generates a 6-digit code that changes every 30
              seconds. Without it, your password is the only thing standing
              between someone and the platform&rsquo;s fares, fleet and rider records.
            </p>
            {status?.requiredByPolicy ? (
              <p className="t-small text-danger mt-2">
                Two-factor is required for every console account. Set it up now —
                you will not be able to work without it.
              </p>
            ) : null}
            <button
              type="button"
              className="btn btn-primary btn-sm mt-4"
              onClick={begin}
              disabled={pending}
            >
              <Icon name="lock" size={14} />
              {pending ? 'Preparing…' : 'Set up two-factor'}
            </button>
          </>
        ) : null}

        {/* ── Step 1: scan ─────────────────────────────────────── */}
        {step === 'scan' ? (
          <div className="flex flex-col gap-3">
            <p className="t-small text-text-dim">
              Scan this with Google Authenticator, 1Password, Authy or any
              equivalent, then type the code it shows.
            </p>

            {qr ? (
              // Rendered server-side into a data URI, so the secret never
              // reaches client JavaScript.
              <Image
                src={qr}
                alt="QR code for two-factor enrolment"
                width={200}
                height={200}
                unoptimized
                className="rounded-md bg-white p-2 self-start"
              />
            ) : null}

            <details>
              <summary className="t-small text-text-dim cursor-pointer">
                Can&rsquo;t scan it? Enter this key by hand
              </summary>
              <p className="mono t-small select-all mt-2 break-all">{secret}</p>
            </details>

            <div className="max-w-xs">
              <label className="label" htmlFor="enrol-code">
                Code from your app
              </label>
              <input
                id="enrol-code"
                className="input mono tracking-widest"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={pending}
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={confirm}
                disabled={pending || code.trim().length !== 6}
              >
                {pending ? 'Checking…' : 'Turn it on'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setStep('idle')}
                disabled={pending}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {/* ── Step 2: recovery codes, shown once ───────────────── */}
        {step === 'codes' ? (
          <div className="flex flex-col gap-3">
            <div className="banner banner-warn" role="alert">
              <strong>Save these now.</strong> They are shown once and cannot be
              retrieved. Each one works a single time, and they are the only way
              back in if you lose your phone.
            </div>
            <ul className="grid grid-cols-2 gap-1 mono t-small select-all">
              {backupCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => navigator.clipboard?.writeText(backupCodes.join('\n'))}
              >
                Copy all
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setStep('idle')}>
                I have saved them
              </button>
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
