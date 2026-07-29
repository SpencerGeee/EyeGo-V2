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
export default function PayDeepLink() {
  const { phone } = useLocalSearchParams<{ phone?: string }>();
  const digits = (phone ?? '').replace(/[^\d+]/g, '');

  if (!digits) return <Redirect href={'/profile/scan-pay' as any} />;
  return <Redirect href={{ pathname: '/profile/send-money', params: { phone: digits } } as any} />;
}
