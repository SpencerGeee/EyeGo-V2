'use server';

import { revalidatePath } from 'next/cache';

import { apiPatch, apiPost, apiDelete } from './api';
import { run, fail, type ActionResult } from './action-result';

/**
 * Every write the console can perform.
 *
 * All of them are Server Actions, so the admin bearer token stays on the server
 * and the browser never holds a credential. They return an ActionResult rather
 * than throwing, because a thrown Server Action is replaced by Next with a
 * generic message that strips the detail the operator needs.
 *
 * Authorisation is NOT decided here. The API's requireRole() is the gate; these
 * simply relay its refusal in readable form. A permission check in this file
 * would be a suggestion, since the API is reachable without the console.
 *
 * revalidatePath after each mutation is what makes the list behind a dialog
 * update — without it the operator approves a driver and the row still says
 * pending, which reads as a failed action and invites a second click.
 */

// ─── Fleet ────────────────────────────────────────────────────────

export async function approveDriver(driverId: string): Promise<ActionResult> {
  const result = await run('Driver approved', () => apiPost(`/drivers/${driverId}/approve`, {}));
  revalidatePath('/drivers');
  revalidatePath('/drivers/pending');
  revalidatePath(`/drivers/${driverId}`);
  return result;
}

export async function suspendDriver(driverId: string, reason?: string): Promise<ActionResult> {
  if (!reason || reason.trim().length < 3) {
    return fail('A reason is required — it is shown to the driver and recorded in the audit log.');
  }
  const result = await run('Driver suspended', () =>
    apiPost(`/drivers/${driverId}/suspend`, { reason: reason.trim() })
  );
  revalidatePath('/drivers');
  revalidatePath(`/drivers/${driverId}`);
  return result;
}

export async function rejectDriver(driverId: string, reason?: string): Promise<ActionResult> {
  if (!reason || reason.trim().length < 3) {
    return fail('A reason is required so the applicant knows what to fix.');
  }
  const result = await run('Application rejected', () =>
    apiPost(`/drivers/${driverId}/reject`, { reason: reason.trim() })
  );
  revalidatePath('/drivers');
  revalidatePath('/drivers/pending');
  revalidatePath(`/drivers/${driverId}`);
  return result;
}

export async function reviewDriverDocument(
  driverId: string,
  type: string,
  approve: boolean,
  rejectionReason?: string
): Promise<ActionResult> {
  if (!approve && (!rejectionReason || rejectionReason.trim().length < 3)) {
    return fail('Say why the document was rejected — the driver has to know what to re-upload.');
  }
  const result = await run(approve ? 'Document approved' : 'Document rejected', () =>
    apiPost(`/drivers/${driverId}/documents/${type}/review`, {
      approve,
      rejectionReason: rejectionReason?.trim(),
    })
  );
  revalidatePath(`/drivers/${driverId}`);
  revalidatePath('/drivers/pending');
  return result;
}

// ─── Riders ───────────────────────────────────────────────────────

export async function banUser(userId: string, reason?: string): Promise<ActionResult> {
  if (!reason || reason.trim().length < 3) {
    return fail('A reason is required for a ban.');
  }
  const result = await run('Rider banned', () =>
    apiPost(`/users/${userId}/ban`, { reason: reason.trim() })
  );
  revalidatePath('/users');
  revalidatePath(`/users/${userId}`);
  return result;
}

export async function unbanUser(userId: string): Promise<ActionResult> {
  const result = await run('Rider reinstated', () => apiPost(`/users/${userId}/unban`, {}));
  revalidatePath('/users');
  revalidatePath(`/users/${userId}`);
  return result;
}

// ─── Dispatch ─────────────────────────────────────────────────────

export async function assignDriverToTrip(tripId: string, driverId: string): Promise<ActionResult> {
  if (!driverId) return fail('Pick a driver first.');
  const result = await run('Driver assigned', () =>
    apiPost(`/trips/${tripId}/assign`, { driverId })
  );
  revalidatePath('/dispatch');
  revalidatePath('/trips');
  revalidatePath(`/trips/${tripId}`);
  return result;
}

export async function setSurge(zoneId: string, multiplier: number): Promise<ActionResult> {
  // Guarded here as well as on the server because a fat-fingered 15x is a
  // pricing incident, and the console should refuse it before it becomes one.
  if (!Number.isFinite(multiplier) || multiplier < 1 || multiplier > 3) {
    return fail('Surge must be between 1.0 and 3.0.');
  }
  const result = await run(`Surge set to ${multiplier.toFixed(1)}x`, () =>
    apiPost(`/surge/${zoneId}`, { multiplier })
  );
  revalidatePath('/surge');
  return result;
}

// ─── Support ──────────────────────────────────────────────────────

export async function respondToTicket(ticketId: string, text?: string): Promise<ActionResult> {
  if (!text || text.trim().length < 2) return fail('Write a reply first.');
  const result = await run('Reply sent', () =>
    apiPost(`/support-tickets/${ticketId}/respond`, { text: text.trim(), senderRole: 'ADMIN' })
  );
  revalidatePath('/tickets');
  revalidatePath(`/tickets/${ticketId}`);
  return result;
}

export async function closeTicket(ticketId: string): Promise<ActionResult> {
  const result = await run('Ticket closed', () => apiPost(`/support-tickets/${ticketId}/close`, {}));
  revalidatePath('/tickets');
  revalidatePath(`/tickets/${ticketId}`);
  return result;
}

// ─── Safety ───────────────────────────────────────────────────────

export async function resolveSosEvent(eventId: string): Promise<ActionResult> {
  const result = await run('SOS marked resolved', () => apiPost(`/sos-events/${eventId}/resolve`, {}));
  revalidatePath('/sos');
  // The nav badge is rendered by the console layout, so the shell has to be
  // revalidated too or the count stays stale until the next full load.
  revalidatePath('/', 'layout');
  return result;
}

export async function resolveTripReport(reportId: string): Promise<ActionResult> {
  const result = await run('Report resolved', () => apiPost(`/trip-reports/${reportId}/resolve`, {}));
  revalidatePath('/trip-reports');
  revalidatePath('/', 'layout');
  return result;
}

// ─── Money ────────────────────────────────────────────────────────

/**
 * Field names here are the API's, exactly: `discountPercent`, `maxDiscountGhs`
 * (the service accepts cedis or pesewas and normalises), `expiry`,
 * `maxRedemptions`. Sending `discountValue`/`expiresAt` — as this action used to
 * — reached the API as `undefined` and failed validation, which is exactly what
 * the audit log recorded as a 400.
 */
export async function createPromotion(payload: {
  code: string;
  discountPercent: number;
  maxDiscountGhs: number;
  maxRedemptions?: number;
  expiry: string;
}): Promise<ActionResult> {
  if (!payload.code || payload.code.trim().length < 3) {
    return fail('A promo code needs at least 3 characters.');
  }
  if (!Number.isInteger(payload.discountPercent) || payload.discountPercent < 1 || payload.discountPercent > 100) {
    return fail('The discount must be a whole number between 1 and 100.');
  }
  if (!Number.isFinite(payload.maxDiscountGhs) || payload.maxDiscountGhs <= 0) {
    return fail('Set a maximum discount greater than zero — an uncapped percentage is unbounded.');
  }
  if (!payload.expiry || Number.isNaN(new Date(payload.expiry).getTime())) {
    return fail('Pick a valid expiry date.');
  }
  const result = await run('Promotion created', () =>
    apiPost('/promotions', { ...payload, code: payload.code.trim().toUpperCase() })
  );
  revalidatePath('/promotions');
  return result;
}

export async function togglePromotion(promotionId: string): Promise<ActionResult> {
  const result = await run('Promotion updated', () => apiPost(`/promotions/${promotionId}/toggle`, {}));
  revalidatePath('/promotions');
  return result;
}

// ─── Platform configuration ───────────────────────────────────────

/**
 * Apply a batch of runtime settings. `null` for a key resets it to the deploy
 * default. Sent as one request so the API's all-or-nothing validation applies:
 * a half-saved pricing change is worse than a rejected one.
 */
export async function updatePlatformSettings(
  settings: Record<string, number | string | boolean | null>,
): Promise<ActionResult> {
  if (!settings || Object.keys(settings).length === 0) return fail('Nothing to save.');
  const result = await run('Settings applied', () => apiPatch('/settings', { settings }));
  revalidatePath('/config');
  // Fares appear on the dashboard and revenue pages too.
  revalidatePath('/', 'layout');
  return result;
}

// ─── Scheduling ───────────────────────────────────────────────────

export async function createPulseSchedule(payload: Record<string, unknown>): Promise<ActionResult> {
  const result = await run('Schedule created', () => apiPost('/pulse-schedules', payload));
  revalidatePath('/pulse-schedules');
  return result;
}

export async function deletePulseSchedule(id: string): Promise<ActionResult> {
  const result = await run('Schedule deleted', () => apiDelete(`/pulse-schedules/${id}`));
  revalidatePath('/pulse-schedules');
  return result;
}

// ─── Platform: releases ───────────────────────────────────────────

export async function publishOta(payload: {
  app: string;
  channel: string;
  message?: string;
  runId?: string;
}): Promise<ActionResult> {
  if (!payload.app || !payload.channel) return fail('Pick an app and a channel.');
  const result = await run(
    payload.runId ? 'Rollback dispatched' : 'Publish dispatched',
    () => apiPost('/ota/publish', payload)
  );
  revalidatePath('/ota');
  return result;
}

// ─── Platform: admin accounts ─────────────────────────────────────

export async function createAdmin(payload: {
  email: string;
  name: string;
  password: string;
  role: string;
}): Promise<ActionResult> {
  const result = await run('Admin created', () => apiPost('/admins', payload));
  revalidatePath('/admins');
  return result;
}

export async function updateAdmin(
  id: string,
  payload: { name?: string; role?: string; isActive?: boolean }
): Promise<ActionResult> {
  const result = await run('Admin updated', () => apiPatch(`/admins/${id}`, payload));
  revalidatePath('/admins');
  return result;
}

export async function resetAdminPassword(id: string, newPassword: string): Promise<ActionResult> {
  if (!newPassword || newPassword.length < 12) {
    return fail('The new password must be at least 12 characters.');
  }
  const result = await run(
    'Password reset. Every session for that admin was signed out.',
    () => apiPost(`/admins/${id}/reset-password`, { newPassword })
  );
  revalidatePath('/admins');
  return result;
}

// ─── Own account ──────────────────────────────────────────────────

export async function changeOwnPassword(
  currentPassword: string,
  newPassword: string
): Promise<ActionResult> {
  if (newPassword.length < 12) {
    return fail('Your new password must be at least 12 characters.');
  }
  if (!/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return fail('Include lower case, upper case and a digit.');
  }
  if (currentPassword === newPassword) {
    return fail('The new password must be different from the current one.');
  }
  return run('Password changed. Sign in again with the new one.', () =>
    apiPost('/auth/change-password', { currentPassword, newPassword })
  );
}

// ─── Money: refunds and wallet adjustments ────────────────────────
//
// FINANCE and superadmin only, enforced by the API. These are the actions that
// move real money out of the business, so each one carries a mandatory reason
// that lands in the audit log next to the operator's name.

export async function issueRefund(
  bookingId: string,
  payload: { amountPesewas: number; reason: string; destination: 'WALLET' | 'GATEWAY' }
): Promise<ActionResult> {
  if (!payload.reason?.trim()) return fail('Say why this is being refunded.');
  if (!Number.isFinite(payload.amountPesewas) || payload.amountPesewas <= 0) {
    return fail('Enter an amount greater than zero.');
  }
  const result = await run('Refund issued', () => apiPost(`/bookings/${bookingId}/refund`, payload));
  revalidatePath('/refunds');
  revalidatePath('/bookings');
  revalidatePath('/trips');
  return result;
}

export async function adjustRiderWallet(
  userId: string,
  payload: { amountPesewas: number; reason: string }
): Promise<ActionResult> {
  if (!payload.reason?.trim()) return fail('A reason is required for every adjustment.');
  if (!Number.isFinite(payload.amountPesewas) || payload.amountPesewas === 0) {
    return fail('Enter an amount. Use a negative number to take money back.');
  }
  const result = await run('Wallet adjusted', () => apiPost(`/users/${userId}/wallet-adjust`, payload));
  revalidatePath(`/users/${userId}`);
  return result;
}

export async function adjustDriverWallet(
  driverId: string,
  payload: { amountPesewas: number; reason: string }
): Promise<ActionResult> {
  if (!payload.reason?.trim()) return fail('A reason is required for every adjustment.');
  if (!Number.isFinite(payload.amountPesewas) || payload.amountPesewas === 0) {
    return fail('Enter an amount. Use a negative number to take money back.');
  }
  const result = await run('Wallet adjusted', () => apiPost(`/drivers/${driverId}/wallet-adjust`, payload));
  revalidatePath(`/drivers/${driverId}`);
  return result;
}

// ─── SOS triage ───────────────────────────────────────────────────

export async function acknowledgeSos(eventId: string): Promise<ActionResult> {
  const result = await run('You are handling this alert', () =>
    apiPost(`/sos-events/${eventId}/acknowledge`, {})
  );
  revalidatePath('/sos');
  revalidatePath('/', 'layout');
  return result;
}

export async function releaseSos(eventId: string): Promise<ActionResult> {
  const result = await run('Returned to the queue', () => apiPost(`/sos-events/${eventId}/release`, {}));
  revalidatePath('/sos');
  return result;
}

export async function resolveSosWithOutcome(eventId: string, outcome: string): Promise<ActionResult> {
  if (!outcome?.trim()) {
    return fail('Say what happened before closing this — a line is enough.');
  }
  const result = await run('SOS resolved', () => apiPost(`/sos-events/${eventId}/resolve`, { outcome }));
  revalidatePath('/sos');
  revalidatePath('/', 'layout');
  return result;
}

// ─── Case notes ───────────────────────────────────────────────────

export async function addNote(
  subjectType: 'User' | 'Driver' | 'Trip' | 'Booking',
  subjectId: string,
  body: string
): Promise<ActionResult> {
  if (!body?.trim()) return fail('Write something first.');
  const result = await run('Note added', () => apiPost(`/notes/${subjectType}/${subjectId}`, { body }));
  revalidatePath(`/${subjectType === 'User' ? 'users' : subjectType === 'Driver' ? 'drivers' : 'trips'}/${subjectId}`);
  return result;
}

export async function deleteNote(noteId: string, revalidate: string): Promise<ActionResult> {
  const result = await run('Note retracted', () => apiDelete(`/notes/${noteId}`));
  revalidatePath(revalidate);
  return result;
}

// ─── Bulk fleet actions ───────────────────────────────────────────

export async function bulkDriverAction(
  driverIds: string[],
  action: 'approve' | 'suspend' | 'reject',
  reason?: string
): Promise<ActionResult> {
  if (!driverIds.length) return fail('Select at least one driver.');
  if ((action === 'reject' || action === 'suspend') && !reason?.trim()) {
    return fail(`Give a reason before you ${action} drivers — they are told what it says.`);
  }
  const result = await run(`${driverIds.length} drivers updated`, () =>
    apiPost('/drivers/bulk', { driverIds, action, reason })
  );
  revalidatePath('/drivers');
  revalidatePath('/drivers/pending');
  revalidatePath('/', 'layout');
  return result;
}

// ─── Two-factor ───────────────────────────────────────────────────

/** Returns the secret and a server-rendered QR — never persisted in readable form. */
export async function beginTotpEnrolment(): Promise<
  ActionResult<{ secret: string; otpauthUri: string; qrDataUri: string | null }>
> {
  return run('Scan the code', () =>
    apiPost<{ secret: string; otpauthUri: string; qrDataUri: string | null }>('/auth/totp/begin', {})
  );
}

/** Returns the recovery codes. Shown once; only bcrypt hashes are stored. */
export async function confirmTotpEnrolment(
  code: string
): Promise<ActionResult<{ backupCodes: string[] }>> {
  if (!/^\d{6}$/.test(code?.trim() ?? '')) {
    return fail<{ backupCodes: string[] }>('Enter the 6-digit code from your app.');
  }
  const result = await run('Two-factor is on', () =>
    apiPost<{ backupCodes: string[] }>('/auth/totp/confirm', { code: code.trim() })
  );
  revalidatePath('/settings');
  return result;
}

export async function disableTotp(code: string): Promise<ActionResult> {
  if (!code?.trim()) return fail('Enter a current code, or one of your recovery codes.');
  const result = await run('Two-factor switched off', () => apiPost('/auth/totp/disable', { code: code.trim() }));
  revalidatePath('/settings');
  return result;
}

export async function resetAdminTotp(adminId: string): Promise<ActionResult> {
  const result = await run('Two-factor cleared and every session signed out', () =>
    apiPost(`/admins/${adminId}/reset-totp`, {})
  );
  revalidatePath('/admins');
  return result;
}
