'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { GlobalSearch } from '@/components/shell/GlobalSearch';
import { Icon } from '@/components/ui/Icon';
import { Avatar } from '@/components/ui/primitives';
import { ROLE_LABEL, type Role } from '@/lib/roles';

/**
 * Top bar: who you are, what power you hold, and how to leave.
 *
 * The role is displayed permanently rather than hidden in a menu. On a console
 * where the same screen shows different actions to different people, "why can't
 * I click that" is the most common support question, and the answer should
 * always be on screen.
 */
export function Topbar({
  admin,
}: {
  admin: { name: string; email: string; role: Role; isLegacy?: boolean };
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      // Full navigation rather than a client push, so no cached server component
      // payload for an authenticated page survives the sign-out.
      window.location.href = '/login';
    }
  };

  return (
    <header
      className="glass sticky top-0 z-40 flex items-center gap-3 px-4 lg:px-6 border-x-0 border-t-0 border-b border-line flex-none"
      style={{ height: 'var(--topbar-h)' }}
    >
      <div className="lg:hidden w-9" aria-hidden="true" />

      {/* One box for riders, drivers, trips and bookings. Sits centre-left so
          it is the first thing reached on a support call, and ⌘K works from
          anywhere in the console. */}
      <GlobalSearch />

      <div className="flex-1" />

      {admin.isLegacy ? (
        <Link
          href="/admins"
          className="badge badge-warn"
          title="You are signed in with the shared ADMIN_SECRET_KEY. Actions are attributed to 'legacy-shared-secret' and cannot be traced to a person."
        >
          <Icon name="alert" size={11} />
          Shared secret session
        </Link>
      ) : null}

      <ThemeToggle />

      <div className="relative" ref={menuRef}>
        <button
          type="button"
          className="flex items-center gap-2.5 h-9 pl-1.5 pr-2.5 rounded-md hover:bg-surface-2 transition-colors"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <Avatar name={admin.name} size={26} />
          <span className="hidden sm:block text-left leading-tight">
            <span className="block t-small font-medium truncate-1 max-w-[150px]">{admin.name}</span>
            <span className="block text-[11px] text-text-faint">{ROLE_LABEL[admin.role]}</span>
          </span>
          <Icon name="chevron-down" size={13} className="text-text-faint" />
        </button>

        {menuOpen ? (
          <div
            role="menu"
            className="popover absolute right-0 top-[calc(100%+6px)] w-64 p-1.5 z-50"
          >
            <div className="px-2.5 py-2 border-b border-line mb-1">
              <p className="t-small font-medium truncate-1">{admin.name}</p>
              <p className="text-[11.5px] text-text-faint truncate-1">{admin.email}</p>
              <p className="text-[11.5px] text-text-dim mt-1.5">{ROLE_LABEL[admin.role]}</p>
            </div>
            <Link href="/settings" role="menuitem" className="nav-item" onClick={() => setMenuOpen(false)}>
              <Icon name="lock" size={14} />
              Password & session
            </Link>
            <button
              type="button"
              role="menuitem"
              className="nav-item w-full text-danger hover:!text-danger"
              onClick={signOut}
              disabled={signingOut}
            >
              <Icon name={signingOut ? 'refresh' : 'logout'} size={14} className={signingOut ? 'spin' : ''} />
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}

/**
 * Theme choice is written to a cookie so the server renders the correct theme on
 * the first paint. Storing it only in localStorage produces the white flash that
 * makes a dark tool feel cheap.
 */
function ThemeToggle() {
  const router = useRouter();
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'light' || attr === 'dark') {
      setTheme(attr);
    } else {
      setTheme(window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    }
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    document.cookie = `eyego_admin_theme=${next};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
    router.refresh();
  };

  return (
    <button
      type="button"
      className="btn btn-ghost btn-icon"
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
    </button>
  );
}
