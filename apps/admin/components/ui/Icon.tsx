/**
 * One icon family, one stroke weight.
 *
 * Inline SVG rather than an icon package or emoji: emoji render differently on
 * every OS and cannot be themed, and a font-based set flashes on first paint.
 * Everything here is 24x24, 1.5px stroke, round caps, and inherits currentColor
 * so a badge or button can recolour it without a variant prop.
 *
 * Decorative by default (aria-hidden). Pass a `title` only when the icon is the
 * sole label for a control — but prefer giving the control an aria-label.
 */

export type IconName =
  | 'grid'
  | 'download'
  | 'chart'
  | 'radar'
  | 'route'
  | 'ticket'
  | 'bolt'
  | 'clock'
  | 'wheel'
  | 'badge-check'
  | 'users'
  | 'siren'
  | 'flag'
  | 'chat'
  | 'cash'
  | 'tag'
  | 'rocket'
  | 'shield'
  | 'scroll'
  | 'search'
  | 'check'
  | 'x'
  | 'alert'
  | 'info'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-left'
  | 'arrow-up'
  | 'arrow-down'
  | 'external'
  | 'refresh'
  | 'logout'
  | 'sun'
  | 'moon'
  | 'menu'
  | 'plus'
  | 'pin'
  | 'phone'
  | 'car'
  | 'ban'
  | 'eye'
  | 'inbox'
  | 'lock'
  | 'sparkle';

const PATHS: Record<IconName, React.ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  chart: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-5 3 3 5-7" />
    </>
  ),
  radar: (
    <>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="8" />
      <path d="M12 12l6-5" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <path d="M8.5 18h5a4 4 0 0 0 4-4V8.5" />
    </>
  ),
  ticket: (
    <>
      <path d="M3 9V6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5V9a3 3 0 0 0 0 6v2.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5V15a3 3 0 0 0 0-6Z" />
      <path d="M12 8v8" strokeDasharray="2 2" />
    </>
  ),
  bolt: <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  wheel: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v5.8M4.2 16.5l5-2.9M19.8 16.5l-5-2.9" />
    </>
  ),
  'badge-check': (
    <>
      <path d="M12 2.5l2.2 1.6 2.7-.2 1 2.5 2.3 1.4-.7 2.6.7 2.6-2.3 1.4-1 2.5-2.7-.2L12 18.3l-2.2-1.6-2.7.2-1-2.5-2.3-1.4.7-2.6-.7-2.6 2.3-1.4 1-2.5 2.7.2Z" />
      <path d="M9 11l2 2 4-4" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 5.3a3.2 3.2 0 0 1 0 5.4M17.5 20a6 6 0 0 0-2-4.5" />
    </>
  ),
  siren: (
    <>
      <path d="M6 18v-4a6 6 0 0 1 12 0v4" />
      <rect x="4" y="18" width="16" height="3" rx="1.5" />
      <path d="M12 2v2M3.5 7.5l1.4 1.4M20.5 7.5l-1.4 1.4" />
    </>
  ),
  flag: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h11l-1.5 4L16 12H5" />
    </>
  ),
  chat: <path d="M21 12a8 8 0 0 1-8 8H8l-4 3v-5.5A8 8 0 0 1 13 4a8 8 0 0 1 8 8Z" />,
  cash: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 10v4M18 10v4" />
    </>
  ),
  tag: (
    <>
      <path d="M12.6 3H20a1 1 0 0 1 1 1v7.4a2 2 0 0 1-.6 1.4l-7.6 7.6a2 2 0 0 1-2.8 0l-6-6a2 2 0 0 1 0-2.8l7.6-7.6a2 2 0 0 1 1.4-.6Z" />
      <circle cx="16.5" cy="7.5" r="1.3" />
    </>
  ),
  rocket: (
    <>
      <path d="M13 3c4 1.5 7 5 8 9-4-1-7.5.5-9.5 3L8 12.5C10 10 11.5 6.5 13 3Z" />
      <path d="M8 12.5 5 15l4 4 2.5-3M5.5 18.5 3 21" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2.5 4.5 5.5v6c0 4.5 3.2 8.6 7.5 10 4.3-1.4 7.5-5.5 7.5-10v-6Z" />
      <path d="M9.2 11.8 11.3 14l3.8-4" />
    </>
  ),
  scroll: (
    <>
      <path d="M5 4h11a2 2 0 0 1 2 2v13a1 1 0 0 0 1 1H7a2 2 0 0 1-2-2Z" />
      <path d="M8.5 8h6M8.5 12h6M8.5 16h3" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21" />
    </>
  ),
  check: <path d="M4.5 12.5 9.5 17.5 20 6.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  alert: (
    <>
      <path d="M12 3.5 21.5 20h-19Z" />
      <path d="M12 9.5v4.5M12 17.2v.1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.8v.1" />
    </>
  ),
  'chevron-right': <path d="M9 5l7 7-7 7" />,
  'chevron-down': <path d="M5 9l7 7 7-7" />,
  'chevron-left': <path d="M15 5l-7 7 7 7" />,
  'arrow-up': <path d="M12 20V4M6 10l6-6 6 6" />,
  'arrow-down': <path d="M12 4v16M18 14l-6 6-6-6" />,
  download: (
    <>
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 21h14" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
      <path d="M20.5 4v5h-5" />
    </>
  ),
  logout: (
    <>
      <path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" />
      <path d="M10 8 6 12l4 4M6 12h9" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  plus: <path d="M12 5v14M5 12h14" />,
  pin: (
    <>
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  phone: (
    <path d="M6.5 3h2.2l1.6 4-2 1.4a11 11 0 0 0 5.3 5.3l1.4-2 4 1.6v2.2a2 2 0 0 1-2.2 2A16 16 0 0 1 4.5 5.2 2 2 0 0 1 6.5 3Z" />
  ),
  car: (
    <>
      <path d="M4 15.5h16v-3l-2-4.5H6l-2 4.5Z" />
      <circle cx="7.5" cy="17.5" r="1.6" />
      <circle cx="16.5" cy="17.5" r="1.6" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  inbox: (
    <>
      <path d="M3 13.5 5.5 5h13L21 13.5V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />
      <path d="M3 13.5h5l1 2.5h6l1-2.5h5" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
    </>
  ),
  sparkle: (
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z" />
  ),
};

type Props = {
  name: IconName;
  size?: number;
  className?: string;
  /** Only for icons that carry meaning on their own. */
  title?: string;
  strokeWidth?: number;
};

export function Icon({ name, size = 16, className, title, strokeWidth = 1.5 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      style={{ flex: 'none' }}
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}
