'use client';

import { useState, useTransition } from 'react';

import { Icon, type IconName } from './Icon';
import { Modal } from './Modal';
import { useToast } from './Toast';
import type { ActionResult } from '@/lib/action-result';

/**
 * The single way this console performs a mutation.
 *
 * Everything a write needs is handled once, here, rather than being
 * re-remembered per page:
 *  - the button disables and shows a spinner while in flight, so a double click
 *    cannot fire the action twice (duplicate trips in this codebase came from
 *    exactly that class of bug);
 *  - destructive actions require confirmation naming the target, because
 *    "Are you sure?" without the name is how the wrong driver gets suspended;
 *  - destructive actions can require a typed reason, which is what actually
 *    reaches the driver and the audit log;
 *  - the result is announced as a toast, and a failure never silently no-ops.
 */

type Props = {
  /** A Server Action. Receives an optional reason for destructive flows. */
  action: (reason?: string) => Promise<ActionResult>;
  label: string;
  icon?: IconName;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  /** Why the action is unavailable — shown as a tooltip so it isn't a mystery. */
  disabledReason?: string;
  /** Turns on the confirmation dialog. */
  confirm?: {
    title: string;
    body: string;
    confirmLabel?: string;
    /** Prompt for a reason; when `required`, the confirm button stays disabled until filled. */
    reason?: { label: string; placeholder?: string; required?: boolean };
  };
  onDone?: (result: ActionResult) => void;
};

export function ActionButton({
  action,
  label,
  icon,
  variant = 'secondary',
  size = 'sm',
  disabled,
  disabledReason,
  confirm,
  onDone,
}: Props) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  const run = (withReason?: string) => {
    startTransition(async () => {
      try {
        const result = await action(withReason);
        if (result.ok) {
          toast.success(result.message);
        } else {
          toast.error(result.message);
        }
        onDone?.(result);
      } catch (err) {
        // A thrown action still has to reach the operator. Swallowing this is
        // how a click appears to succeed while nothing happened.
        toast.error((err as Error)?.message || 'The action failed unexpectedly.');
      } finally {
        setOpen(false);
        setReason('');
      }
    });
  };

  const reasonMissing = !!confirm?.reason?.required && reason.trim().length < 3;

  return (
    <>
      <button
        type="button"
        className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''}`}
        disabled={disabled || pending}
        title={disabled ? disabledReason : undefined}
        aria-busy={pending}
        onClick={() => (confirm ? setOpen(true) : run())}
      >
        {pending ? (
          <Icon name="refresh" size={13} className="spin" />
        ) : icon ? (
          <Icon name={icon} size={13} />
        ) : null}
        {label}
      </button>

      {confirm ? (
        <Modal
          open={open}
          onClose={() => {
            setOpen(false);
            setReason('');
          }}
          title={confirm.title}
          description={confirm.body}
          width={470}
          footer={
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setOpen(false);
                  setReason('');
                }}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`btn btn-sm ${variant === 'danger' ? 'btn-danger' : 'btn-primary'}`}
                disabled={pending || reasonMissing}
                aria-busy={pending}
                onClick={() => run(reason.trim() || undefined)}
              >
                {pending ? <Icon name="refresh" size={13} className="spin" /> : null}
                {confirm.confirmLabel || label}
              </button>
            </>
          }
        >
          {confirm.reason ? (
            <div>
              <label className="label" htmlFor="action-reason">
                {confirm.reason.label}
                {confirm.reason.required ? (
                  <span className="text-danger" aria-hidden="true">
                    {' '}
                    *
                  </span>
                ) : null}
              </label>
              <textarea
                id="action-reason"
                className="textarea"
                value={reason}
                placeholder={confirm.reason.placeholder}
                onChange={(e) => setReason(e.target.value)}
                required={confirm.reason.required}
                aria-describedby="action-reason-hint"
              />
              <p id="action-reason-hint" className="hint">
                This is recorded in the audit log
                {confirm.reason.required ? ' and shown to the person affected.' : '.'}
              </p>
            </div>
          ) : (
            <p className="t-body text-text-dim">This cannot be undone from the console.</p>
          )}
        </Modal>
      ) : null}
    </>
  );
}
