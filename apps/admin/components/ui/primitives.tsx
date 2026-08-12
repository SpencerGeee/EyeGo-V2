import Link from 'next/link';
import type { ReactNode } from 'react';

import { Icon, type IconName } from './Icon';
import type { Tone } from '@/lib/status';

/**
 * Presentational primitives. No hooks and no event handlers, so these stay
 * server components and cost nothing in the client bundle — which matters on a
 * table page that renders a few hundred badges.
 */

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'badge-neutral',
  accent: 'badge-accent',
  info: 'badge-info',
  warn: 'badge-warn',
  danger: 'badge-danger',
  critical: 'badge-critical',
};

/**
 * Status is never colour-only: every badge shows its label as text, and `live`
 * adds a pulsing ring so an in-progress row is findable in greyscale and by
 * someone who cannot separate the hues.
 */
export function Badge({
  tone = 'neutral',
  children,
  icon,
  live,
}: {
  tone?: Tone;
  children: ReactNode;
  icon?: IconName;
  live?: boolean;
}) {
  return (
    <span className={`badge ${TONE_CLASS[tone]}`}>
      {live ? <span className="dot dot-live" /> : icon ? <Icon name={icon} size={11} /> : null}
      {children}
    </span>
  );
}

export function Card({
  children,
  className = '',
  flush,
}: {
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return <div className={`${flush ? 'card-flush' : 'card'} ${className}`}>{children}</div>;
}

export function CardHead({
  title,
  subtitle,
  actions,
  icon,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="card-head">
      <div className="min-w-0">
        <div className="t-heading flex items-center gap-2">
          {icon ? <Icon name={icon} size={14} className="text-text-faint" /> : null}
          <span className="truncate-1">{title}</span>
        </div>
        {subtitle ? <div className="t-small text-text-faint mt-0.5">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card-body ${className}`}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div className="min-w-0">
        <h1 className="t-display">{title}</h1>
        {subtitle ? <p className="t-small text-text-dim mt-1 max-w-[68ch]">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * KPI tile. `delta` is rendered with an arrow glyph as well as a colour, and a
 * rising number is not automatically good — `invertDelta` marks the metrics
 * where up is bad (cancellations, SOS volume), which is otherwise the easiest
 * way for a dashboard to lie cheerfully.
 */
export function StatCard({
  label,
  value,
  hint,
  delta,
  invertDelta,
  icon,
  tone,
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  delta?: number | null;
  invertDelta?: boolean;
  icon?: IconName;
  tone?: Tone;
  href?: string;
}) {
  const hasDelta = delta !== null && delta !== undefined && Number.isFinite(delta);
  const rising = hasDelta && (delta as number) > 0;
  const flat = hasDelta && Math.abs(delta as number) < 0.05;
  const good = invertDelta ? !rising : rising;

  const deltaColor = flat ? 'text-text-faint' : good ? 'text-accent' : 'text-danger';

  const body = (
    /* `card-brand-edge` is the repeatable accent: a 1px brand hairline along the
       top of every KPI tile. Applied here rather than per page so the whole
       console picks it up, and quiet enough that a row of eight tiles still
       reads as one row. A tile carrying a real warning drops the brand edge —
       amber and green competing on the same tile is how a warning gets missed. */
    <div
      className={`card card-brand-edge p-4 h-full flex flex-col gap-2.5 transition-colors hover:border-line-strong ${
        tone === 'danger' || tone === 'warn' ? 'card-brand-edge-off' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="t-eyebrow">{label}</span>
        {icon ? (
          <Icon
            name={icon}
            size={15}
            className={
              tone === 'danger'
                ? 'text-danger'
                : tone === 'warn'
                  ? 'text-warn'
                  : // The accent, at icon scale, on every ordinary tile.
                    'text-accent'
            }
          />
        ) : null}
      </div>
      <div className="t-metric">{value}</div>
      <div className="flex items-center gap-2 min-h-[17px]">
        {hasDelta ? (
          <span className={`t-small font-medium flex items-center gap-0.5 ${deltaColor}`}>
            {!flat ? <Icon name={rising ? 'arrow-up' : 'arrow-down'} size={11} /> : null}
            {flat ? 'no change' : `${Math.abs(delta as number).toFixed(1)}%`}
          </span>
        ) : null}
        {hint ? <span className="t-small text-text-faint truncate-1">{hint}</span> : null}
      </div>
    </div>
  );

  return href ? (
    <Link href={href} className="block h-full focus-visible:outline-accent">
      {body}
    </Link>
  ) : (
    body
  );
}

/**
 * Empty means "nothing here yet", and it always says what to do next. A blank
 * panel is indistinguishable from a broken one.
 */
export function EmptyState({
  icon = 'inbox',
  title,
  body,
  action,
}: {
  icon?: IconName;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-14 gap-3">
      <div className="w-10 h-10 rounded-full bg-surface-3 grid place-items-center text-text-faint">
        <Icon name={icon} size={19} />
      </div>
      <div>
        <div className="t-heading">{title}</div>
        {body ? <div className="t-small text-text-faint mt-1 max-w-[46ch]">{body}</div> : null}
      </div>
      {action}
    </div>
  );
}

/**
 * Failure is shown, never swallowed into an empty table. On an ops console
 * "0 active trips" and "we could not reach the API" must never look the same —
 * that is the difference between a quiet night and an outage nobody noticed.
 */
export function ErrorPanel({
  title = 'Could not load this',
  message,
  action,
}: {
  title?: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center text-center px-6 py-12 gap-3"
    >
      <div className="w-10 h-10 rounded-full bg-danger-soft text-danger grid place-items-center">
        <Icon name="alert" size={19} />
      </div>
      <div>
        <div className="t-heading text-danger">{title}</div>
        <div className="t-small text-text-dim mt-1 max-w-[52ch]">
          {message || 'The request failed. This panel is showing no data, not zero data.'}
        </div>
      </div>
      {action}
    </div>
  );
}

/** Reserves the final layout so nothing shifts when the data lands. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="p-4 space-y-2.5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className={`h-4 ${c === 0 ? 'w-[22%]' : 'flex-1'}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function StatSkeleton() {
  return (
    <div className="card p-4 space-y-3" aria-busy="true">
      <Skeleton className="h-2.5 w-20" />
      <Skeleton className="h-7 w-28" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

/** Label/value row for detail panels. */
export function Detail({
  label,
  children,
  mono,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-line last:border-0">
      <dt className="t-small text-text-faint flex-none">{label}</dt>
      <dd className={`t-small text-right min-w-0 ${mono ? 'mono' : ''}`}>{children ?? '—'}</dd>
    </div>
  );
}

export function Avatar({
  name,
  src,
  size = 30,
}: {
  name?: string | null;
  src?: string | null;
  size?: number;
}) {
  const label = (name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="rounded-full object-cover bg-surface-3 flex-none"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="rounded-full bg-surface-3 text-text-dim grid place-items-center flex-none font-medium"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {label}
    </span>
  );
}

/** Copyable short id with the full value available on hover. */
export function IdChip({ id }: { id: string | null | undefined }) {
  if (!id) return <span className="text-text-faint">—</span>;
  return (
    <span className="mono text-text-dim" title={id}>
      {id.slice(0, 8)}
    </span>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line bg-surface-2">
      {children}
    </div>
  );
}

/** Read-only roles get told why an action is missing instead of just not seeing it. */
export function ReadOnlyNote({ children }: { children?: ReactNode }) {
  return (
    <p className="t-small text-text-faint flex items-center gap-1.5">
      <Icon name="lock" size={12} />
      {children || 'Your role is read-only, so actions on this page are disabled.'}
    </p>
  );
}
