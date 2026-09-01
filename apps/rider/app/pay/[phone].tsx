import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * Deep-link landing route for a scanned EyeGo Pay code.
 *
 * WHY THIS EXISTS: the "My Code" QR used to encode the bare string
 * `eyego:pay:<phone>`. That is not a URL and there was no route to match it, so
 * the code only did anything when scanned from inside EyeGo's own scanner —
 * pointing a phone's camera at it did nothing at all. The QR now encodes
 * `https://eyego.app/pay/<phone>` (universal link, recognised by every camera
 * app) which resolves here, and `eyego://pay/<phone>` resolves here too.
 *
 * All this route does is hand the phone number to Send Money, which owns the
 * amount entry, balance check and confirmation. Nothing is charged by opening
 * a link — a scan can only ever pre-fill a recipient.
 */

/**
 * The requested amount, in cedis, or nothing.
 *
 * BUGFIX. "My Code" appends `?amount=` when the payee names a figure, and the
 * in-app scanner reads it — but this route dropped it. So the amount survived
 * only the one path that did not need a universal link, and the path the link
 * exists FOR (pointing the system camera at the code) landed the payer on an
 * empty amount field, with nothing on screen saying what had been asked for.
 *
 * Validated exactly as `parseScannedCode` validates it, and for the same
 * reason: this value arrives from a link anyone can craft. A plain positive
 * decimal with at most two places is the whole of what is accepted; everything
 * else is dropped rather than forwarded, so a hostile code cannot smuggle a
 * route param through. It remains a HINT either way — Send Money prefills the
 * field and the payer still has to read it and press send.
 */
function amountHint(raw: string | undefined): string | null {
  if (!raw) return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(raw)) return null;
  return Number(raw) > 0 ? raw : null;
}

export default function PayDeepLink() {
  const { phone, amount } = useLocalSearchParams<{ phone?: string; amount?: string }>();
  const digits = (phone ?? '').replace(/[^\d+]/g, '');
  const hint = amountHint(typeof amount === 'string' ? amount : undefined);

  if (!digits) return <Redirect href={'/profile/scan-pay' as any} />;
  return (
    <Redirect
      href={
        {
          pathname: '/profile/send-money',
          params: hint ? { phone: digits, amount: hint } : { phone: digits },
        } as any
      }
    />
  );
}
