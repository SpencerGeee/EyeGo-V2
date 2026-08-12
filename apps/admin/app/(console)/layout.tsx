import { redirect } from 'next/navigation';

import { Sidebar } from '@/components/shell/Sidebar';
import { Topbar } from '@/components/shell/Topbar';
import { apiGetSafe, getAdmin } from '@/lib/api';

/**
 * The authenticated shell.
 *
 * Middleware already rejected requests with no session, but this layout checks
 * again against the API. That is not redundant: middleware only decodes the
 * token, while getAdmin() asks the server, which re-reads the row. A demoted or
 * disabled admin holding a still-unexpired token gets past middleware and is
 * stopped here.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdmin();

  if (!admin) redirect('/login?reason=session');

  // A seeded or reset account must not be able to wander the console on a
  // password someone else chose for it.
  if (admin.mustChangePassword) redirect('/change-password');

  // Attention counts for the nav. Deliberately fault-tolerant: if these fail,
  // the console still loads without badges rather than 500ing the whole shell.
  // Field names follow the API exactly: getSosEvents returns `events`,
  // getTripReports returns `reports`, and TripReport.status defaults to 'OPEN'.
  const [sos, pending, reports] = await Promise.all([
    apiGetSafe<{ events: unknown[]; total: number }>('/sos-events?unresolvedOnly=true&limit=1'),
    apiGetSafe<{ drivers: unknown[] }>('/drivers/pending'),
    apiGetSafe<{ reports: unknown[]; total: number }>('/trip-reports?status=OPEN&limit=1'),
  ]);

  const badges: Record<string, number> = {};
  if (sos?.total) badges['/sos'] = sos.total;
  if (pending?.drivers?.length) badges['/drivers/pending'] = pending.drivers.length;
  if (reports?.total) badges['/trip-reports'] = reports.total;

  return (
    <div className="min-h-dvh">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <Sidebar role={admin.role} badges={badges} />

      <div className="flex flex-col min-h-dvh lg:pl-[var(--sidebar-w)]">
        <Topbar admin={admin} />
        <main id="main" className="flex-1 p-4 lg:p-6 max-w-[1600px] w-full">
          {children}
        </main>
      </div>
    </div>
  );
}
