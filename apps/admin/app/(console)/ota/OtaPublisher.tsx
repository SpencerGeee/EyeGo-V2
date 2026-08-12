'use client';

import { useState, useTransition } from 'react';

import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Badge, Card, CardBody, CardHead, EmptyState, ReadOnlyNote } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { publishOta } from '@/lib/actions';
import { dateTime, relative } from '@/lib/format';

export type OtaApp = {
  app: string;
  name: string;
  channels?: { name?: string; id?: string }[];
  updates?: {
    id?: string;
    message?: string;
    channel?: string;
    runtimeVersion?: string;
    createdAt?: string;
    isRollBackToEmbedded?: boolean;
  }[];
  error?: string;
};

export type OtaRun = {
  id?: string | number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  event?: string;
  createdAt?: string;
  htmlUrl?: string;
  headBranch?: string;
};

export function OtaPublisher({
  apps,
  runs,
  canPublish,
}: {
  apps: OtaApp[];
  runs: OtaRun[];
  canPublish: boolean;
}) {
  const [publishing, setPublishing] = useState<OtaApp | null>(null);

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2 mb-4">
        {apps.length === 0 ? (
          <Card className="lg:col-span-2">
            <EmptyState
              icon="rocket"
              title="No apps reported"
              body="The API returned no app data. This usually means EXPO_TOKEN is unset, so published updates cannot be read."
            />
          </Card>
        ) : (
          apps.map((app) => (
            <Card key={app.app} flush>
              <CardHead
                title={app.name || app.app}
                subtitle={
                  app.channels?.length
                    ? `${app.channels.length} channel${app.channels.length === 1 ? '' : 's'}`
                    : 'no channels visible'
                }
                icon="rocket"
                actions={
                  canPublish ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => setPublishing(app)}
                    >
                      <Icon name="rocket" size={13} />
                      Publish
                    </button>
                  ) : null
                }
              />
              <CardBody>
                {app.error ? (
                  <p className="t-small text-danger flex items-start gap-1.5">
                    <Icon name="alert" size={12} className="mt-0.5" />
                    {app.error}
                  </p>
                ) : app.updates?.length ? (
                  <ol className="space-y-2.5">
                    {app.updates.slice(0, 6).map((u, i) => (
                      <li key={u.id ?? i} className="flex items-start gap-2.5">
                        <span
                          className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-none ${
                            i === 0 ? 'bg-accent' : 'bg-line-strong'
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="t-small truncate-1">
                            {u.message || 'No release message'}
                            {u.isRollBackToEmbedded ? (
                              <>
                                {' '}
                                <Badge tone="warn">rollback</Badge>
                              </>
                            ) : null}
                          </p>
                          <p className="text-[11.5px] text-text-faint">
                            {u.channel ? <span className="mono">{u.channel}</span> : null}
                            {u.runtimeVersion ? (
                              <span className="mono"> · rt {u.runtimeVersion}</span>
                            ) : null}
                            {u.createdAt ? ` · ${relative(u.createdAt)}` : null}
                          </p>
                        </div>
                        {i === 0 ? <Badge tone="accent">live</Badge> : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="t-small text-text-faint">
                    No updates published to this app yet.
                  </p>
                )}
              </CardBody>
            </Card>
          ))
        )}
      </div>

      <Card flush>
        <CardHead
          title="Deploy history"
          subtitle="GitHub Actions runs triggered from this console"
          icon="scroll"
        />
        {runs.length === 0 ? (
          <EmptyState
            icon="scroll"
            title="No deploy runs"
            body="No workflow run has been triggered, or the GitHub token is not configured."
          />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <caption className="sr-only">OTA deploy run history</caption>
              <thead>
                <tr>
                  <th scope="col">Workflow</th>
                  <th scope="col">Result</th>
                  <th scope="col" className="hidden md:table-cell">Branch</th>
                  <th scope="col" className="text-right">Started</th>
                  <th scope="col" className="text-right" />
                </tr>
              </thead>
              <tbody>
                {runs.map((r, i) => {
                  const done = r.status === 'completed';
                  const good = r.conclusion === 'success';
                  return (
                    <tr key={r.id ?? i}>
                      <td className="truncate-1 max-w-[260px]">{r.name || 'Workflow'}</td>
                      <td>
                        {!done ? (
                          <Badge tone="info" live>
                            {r.status || 'running'}
                          </Badge>
                        ) : good ? (
                          <Badge tone="accent" icon="check">
                            Success
                          </Badge>
                        ) : (
                          <Badge tone="danger" icon="alert">
                            {r.conclusion || 'failed'}
                          </Badge>
                        )}
                      </td>
                      <td className="hidden md:table-cell mono text-text-dim">
                        {r.headBranch || '—'}
                      </td>
                      <td className="num text-text-faint" title={dateTime(r.createdAt ?? null)}>
                        {r.createdAt ? relative(r.createdAt) : '—'}
                      </td>
                      <td className="text-right">
                        {r.htmlUrl ? (
                          <a
                            href={r.htmlUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-ghost btn-sm"
                          >
                            <Icon name="external" size={12} />
                            Logs
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!canPublish ? (
          <div className="px-4 py-3 border-t border-line">
            <ReadOnlyNote>Only a superadmin can publish an app release.</ReadOnlyNote>
          </div>
        ) : null}
      </Card>

      <PublishDialog app={publishing} onClose={() => setPublishing(null)} />
    </>
  );
}

function PublishDialog({ app, onClose }: { app: OtaApp | null; onClose: () => void }) {
  const toast = useToast();
  const [channel, setChannel] = useState('');
  const [message, setMessage] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const channels = app?.channels?.map((c) => c.name || c.id).filter(Boolean) as string[] | undefined;

  const close = () => {
    setChannel('');
    setMessage('');
    setConfirmText('');
    setError(null);
    onClose();
  };

  // Typing the channel name is the guard. A release to real phones should cost
  // more than one click, and a checkbox is something people learn to tick.
  const armed = confirmText.trim() === channel.trim() && !!channel.trim();

  const submit = () => {
    if (!app || !armed) return;
    setError(null);
    startTransition(async () => {
      const result = await publishOta({
        app: app.app,
        channel: channel.trim(),
        message: message.trim() || undefined,
      });
      if (result.ok) {
        toast.success(result.message);
        close();
      } else {
        setError(result.message);
      }
    });
  };

  return (
    <Modal
      open={!!app}
      onClose={close}
      title={app ? `Publish ${app.name || app.app}` : ''}
      description="This dispatches a build-and-publish workflow. Every device on the chosen channel receives it."
      confirmOnDismiss={!!message || !!channel}
      width={520}
      footer={
        <>
          <button type="button" className="btn btn-secondary btn-sm" onClick={close} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={submit}
            disabled={!armed || pending}
            aria-busy={pending}
          >
            {pending ? <Icon name="refresh" size={13} className="spin" /> : <Icon name="rocket" size={13} />}
            Publish to {channel || '…'}
          </button>
        </>
      }
    >
      {error ? (
        <div role="alert" className="flex items-start gap-2 p-3 mb-4 rounded-md bg-danger-soft border border-danger-rim">
          <Icon name="alert" size={14} className="text-danger mt-0.5" />
          <p className="t-small text-danger">{error}</p>
        </div>
      ) : null}

      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="ota-channel">
            Channel
          </label>
          {channels?.length ? (
            <select
              id="ota-channel"
              className="select"
              value={channel}
              onChange={(e) => {
                setChannel(e.target.value);
                setConfirmText('');
              }}
            >
              <option value="">Choose a channel…</option>
              {channels.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="ota-channel"
              className="input mono"
              value={channel}
              onChange={(e) => {
                setChannel(e.target.value);
                setConfirmText('');
              }}
              placeholder="production"
              spellCheck={false}
            />
          )}
          <p className="hint">
            {channels?.length
              ? 'Channels read from EAS.'
              : 'No channels could be read from EAS, so type the channel name exactly.'}
          </p>
        </div>

        <div>
          <label className="label" htmlFor="ota-message">
            Release message
          </label>
          <textarea
            id="ota-message"
            className="textarea"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What changed in this release?"
          />
          <p className="hint">Shown in the update history. Write it for whoever debugs this later.</p>
        </div>

        <div className="p-3 rounded-md bg-danger-soft border border-danger-rim">
          <label className="label !text-danger" htmlFor="ota-confirm">
            Type <span className="mono">{channel || 'the channel name'}</span> to confirm
          </label>
          <input
            id="ota-confirm"
            className="input mono"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={!channel}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      </div>
    </Modal>
  );
}
