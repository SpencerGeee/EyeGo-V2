import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';

import { ToastProvider } from '@/components/ui/Toast';
import { THEME_COOKIE } from '@/lib/cookies';

import './globals.css';

export const metadata: Metadata = {
  title: { default: 'EyeGo Console', template: '%s · EyeGo Console' },
  description: 'Operations console for the EyeGo ride platform.',
  // Internal tooling: never indexed, never previewed.
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Zoom is never disabled — an operator reading a dense table may need it.
  maximumScale: 5,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The theme is resolved on the server from the cookie so the first paint is
  // already correct. Reading it in an effect instead produces a white flash on
  // every navigation, which is the single most common tell of a bolted-on dark
  // mode. When the cookie is absent, no attribute is set and the CSS falls back
  // to prefers-color-scheme.
  const store = await cookies();
  const theme = store.get(THEME_COOKIE)?.value;
  const themeAttr = theme === 'light' || theme === 'dark' ? theme : undefined;

  return (
    <html lang="en" data-theme={themeAttr} suppressHydrationWarning>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
