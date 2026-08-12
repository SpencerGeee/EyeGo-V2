'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Icon, type IconName } from '@/components/ui/Icon';
import { navForRole, type Role } from '@/lib/roles';

/**
 * Primary navigation.
 *
 * Placement never changes between pages, sections keep their order, and the
 * current location is marked three ways at once (weight, colour and a rail
 * marker) so it never depends on hue alone.
 *
 * Only the items the signed-in role can actually open are rendered. A greyed-out
 * link the operator can never use is noise, and one that navigates to a page
 * that then 403s in every panel is worse.
 */
export function Sidebar({ role, badges }: { role: Role; badges?: Record<string, number> }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const sections = navForRole(role);

  // Close the drawer on navigation, otherwise it hangs over the page the
  // operator just asked for.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const isCurrent = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  // Longest match wins, so /drivers/pending does not also light up /drivers.
  const activeHref = sections
    .flatMap((s) => s.items)
    .filter((i) => isCurrent(i.href, i.exact))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-icon lg:hidden fixed top-2.5 left-3 z-50"
        aria-label="Open navigation"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Icon name="menu" size={18} />
      </button>

      {open ? (
        <div
          className="scrim lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <aside
        /* Glass, not a solid panel: the nav is chrome floating over the page, and
           letting the brand veil through it is what ties the two together. */
        className={`glass fixed inset-y-0 left-0 z-[70] flex flex-col border-r border-line transition-transform lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ width: 'var(--sidebar-w)' }}
        aria-label="Console navigation"
      >
        <div
          className="flex items-center gap-2.5 px-4 border-b border-line flex-none"
          style={{ height: 'var(--topbar-h)' }}
        >
          <span
            className="w-6 h-6 rounded-md text-[color:var(--on-accent)] grid place-items-center font-bold text-[13px] flex-none"
            style={{
              background: 'linear-gradient(140deg, var(--accent-hover), var(--accent))',
              boxShadow: '0 4px 14px -6px color-mix(in oklab, var(--accent) 70%, transparent)',
            }}
          >
            E
          </span>
          <div className="min-w-0">
            <div className="t-heading leading-none brand-gradient-text">EyeGo</div>
            <div className="text-[10px] text-text-faint tracking-wide leading-none mt-0.5">
              CONSOLE
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm ml-auto lg:hidden"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          >
            <Icon name="x" size={15} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {sections.map((section) => (
            <div key={section.title} className="mb-4 last:mb-0">
              <div className="t-eyebrow px-2.5 mb-1.5">{section.title}</div>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const current = item.href === activeHref;
                  const count = badges?.[item.href];
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="nav-item"
                        aria-current={current ? 'page' : undefined}
                      >
                        <Icon name={item.icon as IconName} size={15} />
                        <span className="truncate-1 flex-1">{item.label}</span>
                        {count ? (
                          <span
                            className={`badge ${
                              item.href === '/sos' ? 'badge-critical' : 'badge-neutral'
                            } !h-[18px] !px-1.5 !text-[10.5px]`}
                          >
                            {count > 99 ? '99+' : count}
                            <span className="sr-only"> needing attention</span>
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
