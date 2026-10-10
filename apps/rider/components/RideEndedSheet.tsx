import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { formatGhs, shortDateTime } from '@eyego/utils';
import type { AwayOutcome } from '@eyego/api';
// Pressable-based, from @eyego/ui — see OutcomeSheet for the composition.
import { OutcomeSheet, goDeeper } from '@eyego/ui';

import { useRideEnded, shouldAnnounce, type RideEndedNotice, type RideEndedReason } from '../stores/rideEnded.store';
// Re-seeded before handing the rider back to the request stage — see `rebook`.
import { useRideStore } from '../stores/ride.store';

/**
 * WHAT THE RIDER SEES WHEN THEIR RIDE IS TAKEN AWAY FROM THEM — or when
 * something happened to it while the app was closed.
 *
 * FEATURE ("if the driver marks as no-show, when the rider is redirected to the
 * homepage they should be given a notification or popup like 'the driver
 * cancelled' or something. It needs to be very aesthetic"; and "if the rider
 * app is closed … it should bring a screen to account for that").
 *
 * The visuals live in @eyego/ui's OutcomeSheet (shared with the driver app);
 * this file owns the words and where each one leads. Every ending gets the
 * money on its own line — read off the server, never inferred — and one way
 * forward that goes where the rider was already going.
 */

type Icon = keyof typeof Ionicons.glyphMap;
type Copy = { title: string; body: string; icon: Icon; cta: string; tone: 'bad' | 'neutral' | 'good' };

function copyFor(n: RideEndedNotice): Copy {
  const when = n.scheduledAt ? shortDateTime(n.scheduledAt) : null;
  const COPY: Record<RideEndedReason, Copy> = {
    DRIVER_CANCELLED: {
      title: 'Your driver cancelled',
      body: 'They are no longer coming. Nothing else about your trip has changed.',
      icon: 'car-outline',
      cta: 'Find another driver',
      tone: 'bad',
    },
    DRIVER_NO_SHOW: {
      title: 'Your driver cancelled',
      body: 'They marked the pickup as a no-show and released the ride.',
      icon: 'car-outline',
      cta: 'Find another driver',
      tone: 'bad',
    },
    RIDER_NO_SHOW: {
      title: 'You were marked as a no-show',
      body: 'Your driver waited at the pickup and couldn’t find you, so they left without you.',
      icon: 'person-remove-outline',
      cta: 'Book another ride',
      tone: 'bad',
    },
    RIDER_CANCELLED: {
      title: 'Ride cancelled',
      body: 'Your ride has been cancelled.',
      icon: 'close-circle-outline',
      cta: 'Book a ride',
      tone: 'neutral',
    },
    NO_DRIVERS: {
      title: 'No drivers free right now',
      body: 'We asked everyone nearby and nobody could take it. This usually clears in a few minutes.',
      icon: 'time-outline',
      cta: 'Try again',
      tone: 'neutral',
    },
    EXPIRED: {
      title: 'Your request timed out',
      body: 'Nobody accepted it in time, so we stopped searching rather than leave you waiting.',
      icon: 'hourglass-outline',
      cta: 'Try again',
      tone: 'neutral',
    },
    CANCELLED_BY_EYEGO: {
      title: 'Your trip was cancelled',
      body: 'EyeGo had to cancel this trip. We’re sorry for the trouble.',
      icon: 'alert-circle-outline',
      cta: 'Book another ride',
      tone: 'bad',
    },
    SEAT_RELEASED: {
      title: 'Your seat hold ran out',
      body: 'The seat wasn’t paid for in time, so it went back to the bus.',
      icon: 'timer-outline',
      cta: 'Pick a seat again',
      tone: 'neutral',
    },
    COMPLETED: {
      title: 'You’ve arrived',
      body: 'Your trip finished while the app was closed. Your receipt is ready — tell us how it went.',
      icon: 'checkmark-circle-outline',
      cta: 'Rate your trip',
      tone: 'good',
    },
    SCHEDULED_MATCHED: {
      title: 'Your scheduled ride has a driver',
      body: when ? `A driver is booked for your ride on ${when}.` : 'A driver is booked for your scheduled ride.',
      icon: 'calendar-outline',
      cta: 'View ride',
      tone: 'good',
    },
    SCHEDULED_EXPIRED: {
      title: 'No driver for your scheduled ride',
      body: when
        ? `We couldn’t find a driver in time for ${when}.`
        : 'We couldn’t find a driver in time for your scheduled ride.',
      icon: 'calendar-clear-outline',
      cta: 'Book a ride now',
      tone: 'bad',
    },
    REFUND_ISSUED: {
      title: 'Refund sent',
      body:
        n.amountPesewas != null
          ? `${formatGhs(n.amountPesewas)} is on its way back to your original payment method.`
          : 'Your refund is on its way back to your original payment method.',
      icon: 'card-outline',
      cta: n.tripId ? 'View receipt' : 'Done',
      tone: 'good',
    },
    SUPPORT_REPLY: {
      title: 'Support replied',
      body: n.preview ?? 'There’s a new reply on your support request.',
      icon: 'chatbubbles-outline',
      cta: 'Read reply',
      tone: 'neutral',
    },
    CASH_CHANGE: {
      title: 'Change added to your wallet',
      body:
        n.amountPesewas != null
          ? `Your driver had no change, so ${formatGhs(n.amountPesewas)} went to your EyeGo wallet.`
          : 'Your driver had no change, so it went to your EyeGo wallet.',
      icon: 'wallet-outline',
      cta: 'View wallet',
      tone: 'good',
    },
    REFERRAL_REWARD: {
      title: 'Referral reward',
      body:
        n.amountPesewas != null
          ? `${formatGhs(n.amountPesewas)} in ride credits — thanks for bringing a friend to EyeGo.`
          : 'Ride credits for bringing a friend to EyeGo.',
      icon: 'gift-outline',
      cta: 'View wallet',
      tone: 'good',
    },
    MONEY_RECEIVED: {
      title: 'You received ride credits',
      body:
        n.amountPesewas != null
          ? `${formatGhs(n.amountPesewas)} was added to your EyeGo wallet.`
          : 'Ride credits were added to your EyeGo wallet.',
      icon: 'wallet-outline',
      cta: 'View wallet',
      tone: 'good',
    },
  };
  return COPY[n.reason];
}

/**
 * The inbox's words for one away-outcome — the sheet's own copy, so the two
 * can never describe the same fact differently. A completed ride in the inbox
 * is history, not "while the app was closed".
 */
export function describeOutcome(o: AwayOutcome): Pick<Copy, 'title' | 'body' | 'icon' | 'tone'> {
  if (o.kind === 'COMPLETED') {
    return {
      title: 'Trip completed',
      body: o.destination ? `Your trip to ${o.destination} is complete.` : 'Your trip is complete.',
      icon: 'checkmark-circle-outline',
      tone: 'good',
    };
  }
  const c = copyFor(noticeOf(o));
  return c ? { title: c.title, body: c.body, icon: c.icon, tone: c.tone } : { title: 'Update', body: '', icon: 'notifications-outline', tone: 'neutral' };
}

/** An away-outcome as the notice the sheet presents. */
export function noticeOf(o: AwayOutcome): RideEndedNotice {
  return {
    reason: o.kind as RideEndedReason,
    refunded: o.money === 'REFUNDED',
    money: o.money,
    destinationLabel: o.destination ?? null,
    journey: null,
    tripId: o.tripId ?? null,
    bookingId: o.bookingId ?? null,
    amountPesewas: o.amountPesewas,
    scheduledAt: o.scheduledAt ?? null,
    ticketId: o.ticketId ?? null,
    preview: o.preview ?? null,
    atMs: Date.now(),
  };
}

/** The money line — only where the ending touches money, and never guessed. */
function moneyFor(n: RideEndedNotice): { icon: Icon; text: string; good?: boolean } | null {
  if (['SCHEDULED_MATCHED', 'REFUND_ISSUED', 'COMPLETED', 'SUPPORT_REPLY', 'MONEY_RECEIVED', 'CASH_CHANGE', 'REFERRAL_REWARD'].includes(n.reason)) return null;
  if (n.reason === 'RIDER_NO_SHOW' && n.money !== 'NOT_CHARGED') {
    return { icon: 'information-circle-outline', text: 'No-show seats aren’t refunded. If you were at the pickup, tell us and we’ll look into it.' };
  }
  if (n.money === 'KEPT') return { icon: 'card-outline', text: 'This payment was kept. If that looks wrong, tell us.' };
  const refunded = n.money ? n.money === 'REFUNDED' : n.refunded;
  return refunded
    ? { icon: 'card-outline', text: 'You have been refunded in full. It lands back on your original payment method.', good: true }
    : { icon: 'shield-checkmark-outline', text: 'You have not been charged for this trip.' };
}

export function RideEndedSheet() {
  const notice = useRideEnded((s) => s.notice);
  const clear = useRideEnded((s) => s.clear);

  if (!notice || !shouldAnnounce(notice.reason)) return null;

  const copy = copyFor(notice);
  const tripId = notice.tripId ?? null;
  const bookingQs = notice.bookingId ? `?bookingId=${notice.bookingId}` : '';

  /**
   * "FIND ANOTHER DRIVER" MUST FIND ANOTHER DRIVER.
   *
   * BUGFIX ("when the ride was marked as no-show there was an option that said
   * find another rider — but when I clicked on it, it brought me to the search
   * stage"). With the journey carried out of the terminal event there is
   * nothing left to ask: re-seed the ride store and land on `request`, which
   * prices and dispatches on mount. `search` is the honest fallback when no
   * journey survived (an ending learned after a cold start).
   */
  const rebook = () => {
    const journey = notice.journey;
    if (journey?.origin && journey?.destination) {
      const ride = useRideStore.getState();
      ride.setOrigin(journey.origin);
      ride.setDestination(journey.destination);
      if (journey.seatCount > 1) ride.setRequestSeats(journey.seatCount, ride.requestCoverAll);
      goDeeper('/trip?stage=request' as never);
      return;
    }
    goDeeper('/trip?stage=search' as never);
  };

  const primary = () => {
    clear();
    switch (notice.reason) {
      case 'COMPLETED':
        if (tripId) return goDeeper(`/ride/${tripId}/complete${bookingQs}` as never);
        return;
      case 'SCHEDULED_MATCHED':
        if (tripId) return goDeeper(`/trip?stage=assigned&tripId=${tripId}` as never);
        return goDeeper('/scheduled-rides' as never);
      case 'SEAT_RELEASED':
        if (tripId) return goDeeper(`/ride/${tripId}` as never);
        return rebook();
      case 'REFUND_ISSUED':
        if (tripId) return goDeeper(`/ride/${tripId}/complete?viewOnly=1` as never);
        return;
      case 'SUPPORT_REPLY':
        return goDeeper(`/profile/help${notice.ticketId ? `?ticket=${notice.ticketId}` : ''}` as never);
      case 'MONEY_RECEIVED':
      case 'CASH_CHANGE':
      case 'REFERRAL_REWARD':
        return goDeeper('/profile/wallet' as never);
      default:
        return rebook();
    }
  };

  // A rider marked absent who WAS there needs a way to say so, right here.
  const secondary =
    notice.reason === 'RIDER_NO_SHOW' && tripId
      ? {
          label: 'I was there',
          onPress: () => {
            clear();
            goDeeper(`/ride/${tripId}/dispute?issue=${encodeURIComponent('Wrongly marked as a no-show')}` as never);
          },
        }
      : null;

  return (
    <OutcomeSheet
      visible
      icon={copy.icon}
      tone={copy.tone}
      title={copy.title}
      body={copy.body}
      money={moneyFor(notice)}
      detail={notice.destinationLabel}
      primary={{ label: copy.cta, onPress: primary }}
      secondary={secondary}
      onDismiss={clear}
    />
  );
}

export default RideEndedSheet;
