'use client';

import { useState, useTransition } from 'react';

import { ActionButton } from '@/components/ui/ActionButton';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { closeTicket, respondToTicket } from '@/lib/actions';
import { dateTime, relative } from '@/lib/format';

export type TicketMessage = {
  id: string;
  senderId: string;
  senderRole: string;
  text: string;
  attachment?: string | null;
  createdAt: string;
};

/**
 * The ticket conversation and reply box.
 *
 * The reply is a draft the operator is composing, so it must not be lost: the
 * text stays in the box if the send fails, and the send button is disabled while
 * in flight so an impatient double-click cannot post the same reply twice.
 */
export function TicketThread({
  ticketId,
  messages,
  canRespond,
  closed,
}: {
  ticketId: string;
  messages: TicketMessage[];
  canRespond: boolean;
  closed: boolean;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [pending, startTransition] = useTransition();

  const send = () => {
    const body = text.trim();
    if (body.length < 2 || pending) return;

    startTransition(async () => {
      const result = await respondToTicket(ticketId, body);
      if (result.ok) {
        // Only cleared on success. Wiping the box on failure would destroy the
        // operator's typing along with the request.
        setText('');
        toast.success('Reply sent');
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <>
      {messages.length === 0 ? (
        <EmptyState
          icon="chat"
          title="No messages"
          body="This ticket was opened without a message body."
        />
      ) : (
        <ol className="p-4 space-y-3">
          {messages.map((m) => {
            const fromAdmin = m.senderRole === 'ADMIN' || m.senderRole === 'SUPPORT';
            return (
              <li key={m.id} className={`flex ${fromAdmin ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[78%] rounded-lg px-3 py-2 border ${
                    fromAdmin
                      ? 'bg-accent-soft border-accent-rim'
                      : 'bg-surface-2 border-line'
                  }`}
                >
                  <p className="t-eyebrow mb-1">
                    {fromAdmin ? 'EyeGo support' : m.senderRole === 'DRIVER' ? 'Driver' : 'Rider'}
                  </p>
                  <p className="t-body whitespace-pre-wrap break-words">{m.text}</p>
                  {m.attachment ? (
                    <a
                      href={m.attachment}
                      target="_blank"
                      rel="noreferrer"
                      className="t-small text-accent hover:underline inline-flex items-center gap-1 mt-1.5"
                    >
                      <Icon name="external" size={11} />
                      Attachment
                    </a>
                  ) : null}
                  <p className="text-[11px] text-text-faint mt-1.5" title={dateTime(m.createdAt)}>
                    {relative(m.createdAt)}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {canRespond ? (
        <div className="p-4 border-t border-line">
          {closed ? (
            <p className="t-small text-text-faint mb-2 flex items-center gap-1.5">
              <Icon name="info" size={12} />
              This ticket is {closed ? 'closed' : 'open'}. Replying reopens the conversation for the
              rider.
            </p>
          ) : null}

          <label className="label" htmlFor="reply">
            Reply
          </label>
          <textarea
            id="reply"
            className="textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a reply. This is sent to the person who opened the ticket."
            aria-describedby="reply-hint"
          />
          <p id="reply-hint" className="hint">
            Sent as EyeGo support and recorded in the audit log against your account.
          </p>

          <div className="flex items-center justify-between gap-2 mt-3">
            <ActionButton
              action={() => closeTicket(ticketId)}
              label="Close ticket"
              icon="check"
              variant="secondary"
              disabled={closed}
              disabledReason="This ticket is already closed."
              confirm={{
                title: 'Close this ticket?',
                body: 'The rider can still reply, which reopens it. Close only once the issue is actually resolved.',
                confirmLabel: 'Close ticket',
              }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={send}
              disabled={text.trim().length < 2 || pending}
              aria-busy={pending}
            >
              {pending ? <Icon name="refresh" size={13} className="spin" /> : <Icon name="chat" size={13} />}
              {pending ? 'Sending…' : 'Send reply'}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
