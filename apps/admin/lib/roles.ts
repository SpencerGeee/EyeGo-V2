/**
 * Role model and navigation map.
 *
 * This file is the single place that answers "who can see what". It is imported
 * by the sidebar (to decide what to render), by middleware (to decide what to
 * allow), and by pages (to decide which actions to offer). Three copies of this
 * list would drift, and the version that drifts is always the one doing the
 * enforcing.
 *
 * Enforcement here governs NAVIGATION only. The real gate is requireRole() in
 * eyego-api/src/middleware/adminRbac.js — anyone can curl the API, so a check
 * that exists only in the frontend is decoration.
 *
 * Safe for both server and client bundles: no secrets, no node built-ins.
 */

export const ROLES = ['SUPERADMIN', 'OPS', 'FINANCE', 'SUPPORT', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  SUPERADMIN: 'Superadmin',
  OPS: 'Operations',
  FINANCE: 'Finance',
  SUPPORT: 'Support',
  VIEWER: 'Viewer',
};

export const ROLE_BLURB: Record<Role, string> = {
  SUPERADMIN: 'Everything, including admin accounts and OTA releases.',
  OPS: 'Dispatch, fleet approval and surge. No money, no releases.',
  FINANCE: 'Revenue, promotions and reconciliation. Read-only elsewhere.',
  SUPPORT: 'Tickets, disputes and SOS triage. Read-only on money and fleet.',
  VIEWER: 'Reads everything. Changes nothing.',
};

/** VIEWER is refused every write by the API's blanket denyReadOnlyWrites guard. */
export const READ_ONLY_ROLES: readonly Role[] = ['VIEWER'];

export function isReadOnly(role: Role | undefined): boolean {
  return !!role && READ_ONLY_ROLES.includes(role);
}

/** SUPERADMIN satisfies every requirement implicitly, exactly as the API does. */
export function can(role: Role | undefined, allowed: readonly Role[]): boolean {
  if (!role) return false;
  if (role === 'SUPERADMIN') return true;
  return allowed.includes(role);
}

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  roles: readonly Role[];
  /** Matches nested routes too, e.g. /drivers/abc highlights /drivers. */
  exact?: boolean;
};

export type NavSection = { title: string; items: NavItem[] };

const ALL: readonly Role[] = ROLES;

export const NAV: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { href: '/', label: 'Dashboard', icon: 'grid', roles: ALL, exact: true },
      { href: '/analytics', label: 'Analytics', icon: 'chart', roles: ALL },
    ],
  },
  {
    title: 'Operations',
    items: [
      { href: '/dispatch', label: 'Live dispatch', icon: 'radar', roles: ALL },
      { href: '/map', label: 'Fleet map', icon: 'pin', roles: ALL },
      { href: '/trips', label: 'Trips', icon: 'route', roles: ALL },
      { href: '/bookings', label: 'Bookings', icon: 'ticket', roles: ALL },
      { href: '/surge', label: 'Surge', icon: 'bolt', roles: ['OPS'] },
      { href: '/pulse-schedules', label: 'Pulse schedules', icon: 'clock', roles: ['OPS'] },
    ],
  },
  {
    title: 'People',
    items: [
      { href: '/drivers', label: 'Drivers', icon: 'wheel', roles: ALL },
      { href: '/drivers/pending', label: 'Driver approvals', icon: 'badge-check', roles: ['OPS'] },
      { href: '/users', label: 'Riders', icon: 'users', roles: ALL },
    ],
  },
  {
    title: 'Safety & support',
    items: [
      { href: '/sos', label: 'SOS events', icon: 'siren', roles: ALL },
      { href: '/trip-reports', label: 'Trip reports', icon: 'flag', roles: ALL },
      { href: '/tickets', label: 'Support tickets', icon: 'chat', roles: ALL },
    ],
  },
  {
    title: 'Money',
    items: [
      { href: '/revenue', label: 'Revenue', icon: 'cash', roles: ['FINANCE'] },
      { href: '/promotions', label: 'Promotions', icon: 'tag', roles: ['FINANCE', 'OPS', 'VIEWER'] },
    ],
  },
  {
    title: 'Platform',
    items: [
      { href: '/ota', label: 'App releases', icon: 'rocket', roles: ['SUPERADMIN'] },
      { href: '/admins', label: 'Admin accounts', icon: 'shield', roles: ['SUPERADMIN'] },
      { href: '/audit-logs', label: 'Audit log', icon: 'scroll', roles: ['SUPERADMIN', 'VIEWER'] },
    ],
  },
];

/**
 * Longest-prefix match so /drivers/pending resolves to its own entry rather
 * than to /drivers. Returns the roles permitted to open a path, or null when
 * the path is not role-restricted (e.g. /settings, /change-password).
 */
export function rolesForPath(pathname: string): readonly Role[] | null {
  let best: NavItem | null = null;
  for (const section of NAV) {
    for (const item of section.items) {
      const matches = item.exact
        ? pathname === item.href
        : pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (!matches) continue;
      if (!best || item.href.length > best.href.length) best = item;
    }
  }
  return best ? best.roles : null;
}

export function navForRole(role: Role | undefined): NavSection[] {
  return NAV.map((section) => ({
    ...section,
    items: section.items.filter((item) => can(role, item.roles)),
  })).filter((section) => section.items.length > 0);
}

/** Where to send someone whose role cannot open the page they asked for. */
export function landingForRole(role: Role | undefined): string {
  if (!role) return '/login';
  return '/';
}
