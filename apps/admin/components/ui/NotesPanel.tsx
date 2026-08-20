'use client';

import { useState, useTransition } from 'react';

import { addNote, deleteNote } from '@/lib/actions';
import { dateTime, relative } from '@/lib/format';

import { Card, CardBody, CardHead, EmptyState } from './primitives';
import { useToast } from './Toast';

export type AdminNote = {
  id: string;
  body: string;
  adminName: string;
  adminEmail: string;
  createdAt: string;
};

/**
 * Case notes on a rider, driver or trip.
 *
 * WHY THIS EXISTS. Every support conversation started from zero. There was
 * nowhere to write "called her, refunded the double charge, do not re-ban", so
 * the next agent to pick up the account re-litigated a case that had already
 * been settled — and the rider told the story twice.
 *
 * Notes are APPEND-ONLY and attributed. Retracting one leaves a visible gap
 * rather than rewriting history: a note somebody can quietly edit is not a
 * record, and these get read back after incidents.
 */
export function NotesPanel({
  subjectType,
  subjectId,
  notes,
  canWrite,
  revalidatePath,
}: {
  subjectType: 'User' | 'Driver' | 'Trip' | 'Booking';
  subjectId: string;
  notes: AdminNote[];
  canWrite: boolean;
  revalidatePath: string;
}) {
  const [body, setBody] = useState('');
  const [pending, start] = useTransition();
  const toast = useToast();

  function submit() {
    const text = body.trim();
    if (!text) return;
    start(async () => {
      const result = await addNote(subjectType, subjectId, text);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      if (result.ok) setBody('');
    });
  }

  return (
    <Card>
      <CardHead
        title="Case notes"
        subtitle="Only visible here. Riders and drivers never see these."
      />
      <CardBody>
        {canWrite ? (
          <div className="mb-4">
            <label className="label" htmlFor={`note-${subjectId}`}>
              Add a note
            </label>
            <textarea
              id={`note-${subjectId}`}
              className="input min-h-20"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What happened, what you did, and anything the next person needs to know."
              maxLength={5000}
              disabled={pending}
              // Ctrl/Cmd+Enter, because a bare Enter in a notes box loses
              // half-written text more often than it saves a keystroke.
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
              }}
            />
            <div className="flex items-center justify-between mt-2">
              <span className="t-small text-text-dim">
                {body.length > 4500 ? `${5000 - body.length} characters left` : 'Ctrl+Enter to save'}
              </span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={submit}
                disabled={pending || !body.trim()}
              >
                {pending ? 'Saving…' : 'Add note'}
              </button>
            </div>
          </div>
        ) : null}

        {notes.length === 0 ? (
          <EmptyState
            title="No notes yet"
            body={
              canWrite
                ? 'Write down anything the next person handling this account would want to know.'
                : 'Nobody has written a note on this record.'
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {notes.map((note) => (
              <li key={note.id} className="border-l-2 border-border pl-3">
                <p className="t-body whitespace-pre-wrap">{note.body}</p>
                <div className="flex items-center gap-2 mt-1 t-small text-text-dim">
                  <span>{note.adminName}</span>
                  <span aria-hidden="true">·</span>
                  <time dateTime={note.createdAt} title={dateTime(note.createdAt)}>
                    {relative(note.createdAt)}
                  </time>
                  {canWrite ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <button
                        type="button"
                        className="link-subtle"
                        onClick={() =>
                          start(async () => {
                            const r = await deleteNote(note.id, revalidatePath);
                            if (r.ok) toast.success(r.message);
                            else toast.error(r.message);
                          })
                        }
                      >
                        Retract
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
