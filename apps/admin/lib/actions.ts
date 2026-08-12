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

export async function createPromotion(payload: {
  code: string;
  description?: string;
  discountType: string;
  discountValue: number;
  maxUses?: number;
  expiresAt?: string;
  minFarePesewas?: number;
}): Promise<ActionResult> {
  if (!payload.code || payload.code.trim().length < 3) {
    return fail('A promo code needs at least 3 characters.');
  }
  if (!Number.isFinite(payload.discountValue) || payload.discountValue <= 0) {
    return fail('Enter a discount greater than zero.');
  }
  if (payload.discountType === 'PERCENTAGE' && payload.discountValue > 100) {
    return fail('A percentage discount cannot exceed 100%.');
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
