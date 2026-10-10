import React, { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { driverApi, type AwayOutcome } from '@eyego/api';
import { formatGhs } from '@eyego/utils';
import { OutcomeSheet, goDeeper } from '@eyego/ui';

/**
 * WHAT HAPPENED WHILE THE DRIVER APP WAS CLOSED.
 *
 * BUGFIX (item 9: "make sure you think about all the other pages and flows that
 * would warrant a silent response on app restart"). The driver side had the same
 * hole as the rider's: a rider cancelling, EyeGo closing a stale trip, seats
 * booked or given back on tomorrow's bus, a tip, a payout bouncing, a document
 * reviewed — each told once on a socket or a push, and lost with a killed app.
 *
 * On cold start and every foreground: read the server's last 48 h
 * (away-outcomes.service), drop what this device already showed, present the
 * rest one sheet at a time, newest first.
 *
 * Facts from the last foreground stretch are NOT shown: the driver was looking,
 * and DriverTripStatusListener already bannered them ("A passenger cancelled",
 * "Kofi took seat 3"). Without that, every banner came back a second time on
 * the next return as "while you were away". They stay in the inbox.
 */

type Icon = keyof typeof Ionicons.glyphMap;
export type Present = {
  icon: Icon;
  tone: 'bad' | 'neutral' | 'good';
  title: string;
  body: string;
  cta: string;
  go?: string;
};

const SEEN_KEY = 'eyego.driver.awaySeen.v1';
const MIN_GAP_MS = 30_000;
/** Inbox-only: the driver did these themselves. */
const NOT_FOR_SHEET = new Set(['TRIP_COMPLETED']);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const docName = (t?: string) => (t ? t.toLowerCase().replace(/_/g, ' ') : 'document');
const toWhere = (o: AwayOutcome) => (o.destination ? ` to ${o.destination}` : '');

type Seen = { keys: string[]; lastAtMs: number; liveFrom?: number; liveTo?: number };

export async function loadDriverSeen(): Promise<Seen> {
  const raw = await AsyncStorage.getItem(SEEN_KEY).catch(() => null);
  try {
    return raw ? { keys: [], lastAtMs: 0, ...JSON.parse(raw) } : { keys: [], lastAtMs: 0 };
  } catch {
    return { keys: [], lastAtMs: 0 };
  }
}

async function saveSeen(patch: Partial<Seen>): Promise<void> {
  const cur = await loadDriverSeen();
  const next = { ...cur, ...patch, keys: (patch.keys ?? cur.keys).slice(-300) };
  await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(next)).catch(() => {});
}

/** The words for one fact — shared by this sheet and the Alerts inbox. */
export function present(o: AwayOutcome): Present | null {
  const amount = o.amountPesewas != null ? formatGhs(o.amountPesewas) : null;
  switch (o.kind) {
    case 'RIDER_CANCELLED':
      return {
        icon: 'person-remove-outline', tone: 'bad', title: 'The rider cancelled',
        body: `Your trip${toWhere(o)} was cancelled by the rider. You're free for new requests.`,
        cta: 'See my trips', go: '/(tabs)/trips',
      };
    case 'TRIP_CANCELLED_BY_EYEGO':
      return {
        icon: 'alert-circle-outline', tone: 'bad', title: 'A trip was cancelled',
        body: `EyeGo cancelled your trip${toWhere(o)}. Nothing in your wallet changed for it.`,
        cta: 'See my trips', go: '/(tabs)/trips',
      };
    case 'TRIP_EXPIRED':
      return {
        icon: 'hourglass-outline', tone: 'neutral', title: 'A trip was closed',
        body: `Your trip${toWhere(o)} passed its time without starting, so it was closed automatically.`,
        cta: 'See my trips', go: '/(tabs)/trips',
      };
    case 'TRIP_COMPLETED':
      return {
        icon: 'checkmark-circle-outline', tone: 'good', title: 'Trip completed',
        body: `Your trip${toWhere(o)} is complete.`,
        cta: 'View trip', go: o.tripId ? `/(trip)/complete/${o.tripId}` : '/(tabs)/trips',
      };
    case 'SEATS_CHANGED': {
      const booked = o.booked ?? 0;
      const cancelled = o.cancelled ?? 0;
      const parts = [booked ? `${plural(booked, 'seat')} booked` : null, cancelled ? `${plural(cancelled, 'seat')} given back` : null]
        .filter(Boolean)
        .join(', ');
      return {
        icon: 'people-outline', tone: booked ? 'good' : 'neutral',
        title: booked ? `${plural(booked, 'new seat')} on your trip` : 'A passenger cancelled',
        body: `While you were away: ${parts}.`,
        cta: 'Open trip', go: o.tripId ? `/(trip)/active/${o.tripId}` : '/(tabs)/trips',
      };
    }
    case 'TIP_RECEIVED':
      return {
        icon: 'heart-outline', tone: 'good', title: 'You got a tip',
        body: `${amount ?? 'A tip'} from a rider is in your wallet.`, cta: 'View earnings', go: '/(tabs)/earnings',
      };
    case 'BONUS_RECEIVED':
      return {
        icon: 'trophy-outline', tone: 'good', title: 'Bonus earned',
        body: `${amount ?? 'A quest bonus'} was added to your wallet.`, cta: 'View earnings', go: '/(tabs)/earnings',
      };
    case 'CANCELLATION_FEE_EARNED':
      return {
        icon: 'cash-outline', tone: 'good', title: 'Cancellation fee earned',
        body: `${amount ?? 'A fee'} is in your wallet for a rider who cancelled late or didn’t show.`,
        cta: 'View earnings', go: '/(tabs)/earnings',
      };
    case 'PAYOUT_COMPLETED':
      return {
        icon: 'cash-outline', tone: 'good', title: 'Cash-out complete',
        body: `${amount ?? 'Your withdrawal'} was sent to your payout account.`, cta: 'View earnings', go: '/(tabs)/earnings',
      };
    case 'PAYOUT_FAILED':
      return {
        icon: 'card-outline', tone: 'bad', title: 'A payout didn’t go through',
        body: `${amount ?? 'The money'} came back to your wallet. Check your payout details and try again.`,
        cta: 'View earnings', go: '/(tabs)/earnings',
      };
    case 'DOCUMENT_APPROVED':
      return {
        icon: 'document-text-outline', tone: 'good', title: 'Document approved',
        body: `Your ${docName(o.documentType)} was approved.`, cta: 'Done',
      };
    case 'DOCUMENT_REJECTED':
      return {
        icon: 'document-text-outline', tone: 'bad', title: 'A document needs attention',
        body: `Your ${docName(o.documentType)} was not accepted${o.reason ? `: ${o.reason}` : ''}. Upload a new one to stay on the road.`,
        cta: 'Fix it', go: '/(profile)/documents',
      };
    case 'DOCUMENT_EXPIRING': {
      const days = o.expiresAt ? Math.max(0, Math.ceil((Date.parse(o.expiresAt) - Date.now()) / 86_400_000)) : null;
      return {
        icon: 'alarm-outline', tone: 'bad', title: 'A document is expiring',
        body: `Your ${docName(o.documentType)} expires ${days == null ? 'soon' : days === 0 ? 'today' : `in ${plural(days, 'day')}`}. Upload a current copy so you can keep going online.`,
        cta: 'Update it', go: '/(profile)/documents',
      };
    }
    case 'SUPPORT_REPLY':
      return {
        icon: 'chatbubbles-outline', tone: 'neutral', title: 'Support replied',
        body: o.preview ?? 'There’s a new reply on your support request.',
        cta: 'Read reply', go: `/(profile)/help${o.ticketId ? `?ticket=${o.ticketId}` : ''}`,
      };
    case 'REPORT_RESOLVED':
      return {
        icon: 'shield-checkmark-outline', tone: 'neutral', title: 'Your report was reviewed',
        body: 'Support has reviewed the trip report you filed. Thanks for flagging it.', cta: 'Done',
      };
    default:
      return null;
  }
}

export function AwayOutcomesSheet() {
  const [queue, setQueue] = useState<AwayOutcome[]>([]);
  const busy = useRef(false);
  const lastRun = useRef(0);

  useEffect(() => {
    let foregroundSince = Date.now();
    const run = async () => {
      if (busy.current || Date.now() - lastRun.current < MIN_GAP_MS) return;
      busy.current = true;
      lastRun.current = Date.now();
      try {
        const seen = await loadDriverSeen();
        const res = await driverApi.outcomes(seen.lastAtMs ? seen.lastAtMs - 5 * 60_000 : undefined);
        const list: AwayOutcome[] = (res.data as any)?.data?.outcomes ?? [];
        const unseen = list.filter((o) => !seen.keys.includes(o.key));
        const whileLooking = (o: AwayOutcome) => {
          const t = Date.parse(o.at);
          return !!seen.liveTo && t >= (seen.liveFrom ?? 0) && t <= seen.liveTo;
        };
        const fresh = unseen.filter((o) => present(o) && !NOT_FOR_SHEET.has(o.kind) && !whileLooking(o));
        await saveSeen({ keys: [...seen.keys, ...unseen.map((o) => o.key)], lastAtMs: Date.now() });
        if (fresh.length) setQueue((q) => [...q, ...fresh]);
      } catch {
        // Offline — the next foreground asks again.
      } finally {
        busy.current = false;
      }
    };
    void run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        foregroundSince = Date.now();
        void run();
      } else if (s === 'background') {
        void saveSeen({ liveFrom: foregroundSince, liveTo: Date.now() });
      }
    });
    return () => sub.remove();
  }, []);

  const current = queue[0];
  const p = current ? present(current) : null;
  if (!current || !p) return null;

  const next = () => setQueue((q) => q.slice(1));
  return (
    <OutcomeSheet
      visible
      icon={p.icon}
      tone={p.tone}
      title={p.title}
      body={p.body}
      primary={{
        label: p.cta,
        onPress: () => {
          next();
          if (p.go) goDeeper(p.go);
        },
      }}
      onDismiss={next}
    />
  );
}
