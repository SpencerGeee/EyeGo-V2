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
 */

type Icon = keyof typeof Ionicons.glyphMap;
type Present = {
  icon: Icon;
  tone: 'bad' | 'neutral' | 'good';
  title: string;
  body: string;
  cta: string;
  go?: string;
};

const SEEN_KEY = 'eyego.driver.awaySeen.v1';
const MIN_GAP_MS = 30_000;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const docName = (t?: string) => (t ? t.toLowerCase().replace(/_/g, ' ') : 'document');
const toWhere = (o: AwayOutcome) => (o.destination ? ` to ${o.destination}` : '');

function present(o: AwayOutcome): Present | null {
  const amount = o.amountPesewas != null ? formatGhs(o.amountPesewas) : null;
  switch (o.kind) {
    case 'RIDER_CANCELLED':
      return {
        icon: 'person-remove-outline', tone: 'bad', title: 'The rider cancelled',
        body: `Your trip${toWhere(o)} was cancelled by the rider while the app was closed. You're free for new requests.`,
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
    default:
      return null;
  }
}

export function AwayOutcomesSheet() {
  const [queue, setQueue] = useState<AwayOutcome[]>([]);
  const busy = useRef(false);
  const lastRun = useRef(0);

  useEffect(() => {
    const run = async () => {
      if (busy.current || Date.now() - lastRun.current < MIN_GAP_MS) return;
      busy.current = true;
      lastRun.current = Date.now();
      try {
        const raw = await AsyncStorage.getItem(SEEN_KEY).catch(() => null);
        const seen: { keys: string[]; lastAtMs: number } = raw ? JSON.parse(raw) : { keys: [], lastAtMs: 0 };
        const res = await driverApi.outcomes(seen.lastAtMs ? seen.lastAtMs - 5 * 60_000 : undefined);
        const list: AwayOutcome[] = (res.data as any)?.data?.outcomes ?? [];
        const fresh = list.filter((o) => !seen.keys.includes(o.key) && present(o));
        await AsyncStorage.setItem(
          SEEN_KEY,
          JSON.stringify({ keys: [...seen.keys, ...fresh.map((o) => o.key)].slice(-300), lastAtMs: Date.now() }),
        ).catch(() => {});
        if (fresh.length) setQueue((q) => [...q, ...fresh]);
      } catch {
        // Offline — the next foreground asks again.
      } finally {
        busy.current = false;
      }
    };
    void run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void run();
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
