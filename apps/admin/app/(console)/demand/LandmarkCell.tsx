'use client';

import { useState, useTransition } from 'react';

import { updateStopLandmark } from '@/lib/actions';

/** Y2 (Yango landmark guidance): one short phrase per stop, saved on blur. */
export function LandmarkCell({ id, value, canManage }: { id: string; value: string | null; canManage: boolean }) {
  const [text, setText] = useState(value ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!canManage) return <span>{value ?? '—'}</span>;
  const save = () => {
    if (text.trim() === (value ?? '')) return;
    start(async () => {
      const r = await updateStopLandmark(id, text);
      setMsg(r.ok ? 'Saved' : r.message || 'Failed');
    });
  };
  return (
    <span>
      <input
        value={text}
        maxLength={80}
        placeholder="e.g. after the footbridge"
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        disabled={pending}
        aria-label="Stop landmark"
      />{' '}
      {msg ? <small>{msg}</small> : null}
    </span>
  );
}
