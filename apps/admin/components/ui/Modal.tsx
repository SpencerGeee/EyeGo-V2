'use client';

import { useCallback, useEffect, useRef } from 'react';

import { Icon } from './Icon';

/**
 * Dialog with the escape routes a modal is required to have: a visible close
 * button, Escape, and a click on the scrim. Focus is moved in on open, trapped
 * while open, and returned to the trigger on close — without that, a keyboard
 * user tabs straight out of the dialog into the page behind it.
 *
 * The blur on the scrim is functional, not decorative: it signals that the
 * background is dismissible and not interactive.
 */

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 480,
  /** Set when the dialog holds unsaved input, so a stray Escape cannot discard it. */
  confirmOnDismiss,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  confirmOnDismiss?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  const attemptClose = useCallback(() => {
    if (confirmOnDismiss) {
      // Native confirm is deliberate here: it cannot be missed, and a bespoke
      // "are you sure" dialog stacked on a dialog is worse than the platform one.
      const ok = window.confirm('Discard your changes?');
      if (!ok) return;
    }
    onClose();
  }, [confirmOnDismiss, onClose]);

  useEffect(() => {
    if (!open) return;

    restoreTo.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        attemptClose();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;

      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null
      );
      if (nodes.length === 0) return;

      const firstNode = nodes[0]!;
      const lastNode = nodes[nodes.length - 1]!;

      if (e.shiftKey && document.activeElement === firstNode) {
        e.preventDefault();
        lastNode.focus();
      } else if (!e.shiftKey && document.activeElement === lastNode) {
        e.preventDefault();
        firstNode.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreTo.current?.focus?.();
    };
  }, [open, attemptClose]);

  if (!open) return null;

  return (
    <div className="scrim grid place-items-center p-4" onMouseDown={attemptClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={description ? 'modal-desc' : undefined}
        tabIndex={-1}
        className="modal w-full max-h-[88vh] flex flex-col outline-none"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-4 pb-3 border-b border-line">
          <div className="min-w-0">
            <h2 className="t-title">{title}</h2>
            {description ? (
              <p id="modal-desc" className="t-small text-text-dim mt-1">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={attemptClose}
            aria-label="Close dialog"
            className="btn btn-ghost btn-icon btn-sm"
          >
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1">{children}</div>

        {footer ? (
          <div className="flex items-center justify-end gap-2 p-4 pt-3 border-t border-line">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
