'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { Icon } from './Icon';

/**
 * Toasts announce the result of an action.
 *
 * Two rules that are easy to get wrong and matter for accessibility:
 *  - the region is aria-live="polite" and never receives focus, so a screen
 *    reader is told what happened without losing the user's place;
 *  - errors do NOT auto-dismiss. A success can vanish; a failure the operator
 *    may not have seen must not.
 */

type ToastKind = 'success' | 'error' | 'info';

type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
  /** Optional follow-up, e.g. an undo. */
  action?: { label: string; onClick: () => void };
};

type ToastApi = {
  success: (message: string, action?: Toast['action']) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const AUTO_DISMISS_MS = 4500;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, message: string, action?: Toast['action']) => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-3), { id, kind, message, action }]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (m, a) => push('success', m, a),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[min(380px,calc(100vw-2rem))] pointer-events-none"
      >
        {toasts.map((t) => (
          <ToastRow key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    // Errors persist until dismissed — see the note at the top of this file.
    if (toast.kind === 'error') return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.kind, onDismiss]);

  const tone =
    toast.kind === 'success'
      ? 'border-accent-rim text-accent'
      : toast.kind === 'error'
        ? 'border-danger text-danger'
        : 'border-line-strong text-info';

  return (
    <div
      className={`popover pointer-events-auto flex items-start gap-2.5 p-3 pr-2.5 border ${tone}`}
      style={{ animation: 'modal-in var(--t-enter)' }}
    >
      <Icon
        name={toast.kind === 'success' ? 'check' : toast.kind === 'error' ? 'alert' : 'info'}
        size={15}
        className="mt-0.5"
      />
      <p className="t-small text-text flex-1 min-w-0">{toast.message}</p>
      {toast.action ? (
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => {
            toast.action?.onClick();
            onDismiss();
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="btn btn-sm btn-ghost btn-icon !w-6 !h-6 text-text-faint"
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used inside <ToastProvider>. Wrap the console layout.');
  }
  return ctx;
}
