'use client';

import { ActionButton } from '@/components/ui/ActionButton';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Badge, EmptyState } from '@/components/ui/primitives';
import { reviewMapReport } from '@/lib/actions';
import { dateTime, humanise, phone as fmtPhone, relative } from '@/lib/format';

export type MapReport = {
  id: string;
  type: string;
  status: string;
  lat: number;
  lng: number;
  name?: string | null;
  address?: string | null;
  note?: string | null;
  payload?: Record<string, unknown> | null;
  photos?: string[];
  reviewNote?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  userId?: string | null;
  driverId?: string | null;
  user?: { id: string; name: string; phone: string } | null;
};

/** Icon and tone per report type, so the queue is scannable without reading. */
const TYPE_META: Record<string, { icon: IconName; label: string }> = {
  ADD_PLACE: { icon: 'plus', label: 'New place' },
  EDIT_PLACE: { icon: 'tag', label: 'Place fix' },
  EDIT_ADDRESS: { icon: 'pin', label: 'Address fix' },
  ADD_OBJECT: { icon: 'route', label: 'Road object' },
  ROAD_ISSUE: { icon: 'alert', label: 'Road problem' },
  COMMENT: { icon: 'chat', label: 'Comment' },
};

const STATUS_TONE: Record<string, 'warn' | 'accent' | 'danger' | 'neutral'> = {
  PENDING: 'warn',
  IN_REVIEW: 'neutral',
  ACCEPTED: 'accent',
  REJECTED: 'danger',
  DUPLICATE: 'neutral',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'New',
  IN_REVIEW: 'Being checked',
  ACCEPTED: 'Applied',
  REJECTED: 'Rejected',
  DUPLICATE: 'Duplicate',
};

export function MapReportsList({
  reports,
  canReview,
}: {
  reports: MapReport[];
  canReview: boolean;
}) {
  if (reports.length === 0) {
    return (
      <EmptyState
        icon="pin"
        title="Nothing here"
        body="No reports match this filter. On the default New view, that means the queue is clear."
      />
    );
  }

  return (
    <ul className="divide-y divide-line">
      {reports.map((r) => {
        const meta = TYPE_META[r.type] ?? { icon: 'pin' as IconName, label: humanise(r.type) };
        const open = r.status === 'PENDING' || r.status === 'IN_REVIEW';
        const who = r.user?.name ?? (r.driverId ? 'A driver' : 'Someone');
        /**
         * The exact point, as a link an operator can open.
         *
         * Built from the COORDINATES rather than the address text: the whole
         * value of a map report is the precise spot, and a `?query=<address>`
         * link asks Google to search for a string and land wherever it decides
         * that means.
         */
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}`;

        return (
          <li key={r.id} className={`p-4 ${open ? 'bg-warn-soft/20' : ''}`}>
            <div className="flex flex-wrap items-start gap-3">
              <span
                className={`w-8 h-8 rounded-full grid place-items-center flex-none ${
                  open ? 'bg-warn-soft text-warn' : 'bg-surface-3 text-text-faint'
                }`}
              >
                <Icon name={meta.icon} size={15} />
              </span>

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="t-heading">{r.name || r.address || meta.label}</span>
                  <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>
                    {STATUS_LABEL[r.status] ?? humanise(r.status)}
                  </Badge>
                  <span className="t-small text-text-faint">{meta.label}</span>
                  <span className="t-small text-text-faint" title={dateTime(r.createdAt)}>
                    filed {relative(r.createdAt)}
                  </span>
                </div>

                {r.note ? <p className="t-body text-text-muted mb-1">{r.note}</p> : null}

                {/*
                  The structured half of the report. Rendered generically from
                  the payload rather than switched on the type: the six types
                  share one blob whose shape the SERVER owns
                  (map-report.service.js PAYLOAD_SHAPES), and duplicating that
                  vocabulary here is how the console comes to disagree with what
                  was actually collected.
                */}
                {r.payload && Object.keys(r.payload).length > 0 ? (
                  <dl className="flex flex-wrap gap-x-4 gap-y-1 t-small text-text-faint mb-1">
                    {Object.entries(r.payload).map(([k, v]) => (
                      <span key={k}>
                        <dt className="inline text-text-faint">{humanise(k)}: </dt>
                        <dd className="inline text-text-muted">{humanise(String(v))}</dd>
                      </span>
                    ))}
                  </dl>
                ) : null}

                {r.photos && r.photos.length > 0 ? (
                  <div className="flex gap-2 my-2">
                    {r.photos.map((url) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <a key={url} href={url} target="_blank" rel="noreferrer">
                        <img
                          src={url}
                          alt="Reporter's photo"
                          className="w-16 h-16 rounded-md object-cover border border-line"
                        />
                      </a>
                    ))}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-3 t-small text-text-faint">
                  <a href={mapsUrl} target="_blank" rel="noreferrer" className="hover:text-text underline">
                    {r.lat.toFixed(5)}, {r.lng.toFixed(5)}
                  </a>
                  <span>
                    {who}
                    {r.user?.phone ? ` · ${fmtPhone(r.user.phone)}` : ''}
                  </span>
                </div>

                {/* A verdict without its reason is indistinguishable from one
                    nobody read. The API requires it for a rejection; this is
                    where the next operator sees it. */}
                {r.reviewNote ? (
                  <p className="t-small text-text-muted mt-2 border-l-2 border-line pl-2">
                    {r.reviewNote}
                  </p>
                ) : null}
              </div>

              {canReview ? (
                <div className="flex flex-wrap gap-2 flex-none">
                  {r.status === 'PENDING' ? (
                    <ActionButton
                      action={() => reviewMapReport(r.id, 'IN_REVIEW')}
                      label="Claim"
                      icon="eye"
                      variant="ghost"
                    />
                  ) : null}
                  {open ? (
                    <>
                      <ActionButton
                        action={(reason) => reviewMapReport(r.id, 'ACCEPTED', reason)}
                        label="Apply"
                        icon="check"
                        variant="primary"
                        confirm={{
                          title: 'Mark as applied',
                          body: 'Confirms the correction is real and has been actioned on the map data.',
                          confirmLabel: 'Applied',
                          reason: { label: 'What you changed (optional)', placeholder: 'Moved the pin to the gate on Osu Badu St' },
                        }}
                      />
                      <ActionButton
                        action={(reason) => reviewMapReport(r.id, 'REJECTED', reason)}
                        label="Reject"
                        icon="x"
                        variant="danger"
                        confirm={{
                          title: 'Reject this report',
                          body: 'The reporter sees your reason in their app, so write it for them.',
                          confirmLabel: 'Reject',
                          reason: {
                            label: 'Why',
                            placeholder: "Couldn't confirm this on the ground",
                            required: true,
                          },
                        }}
                      />
                      <ActionButton
                        action={(reason) => reviewMapReport(r.id, 'DUPLICATE', reason)}
                        label="Duplicate"
                        icon="inbox"
                        variant="secondary"
                        confirm={{
                          title: 'Mark as duplicate',
                          body: 'Use when this corner has already been reported and is being handled.',
                          confirmLabel: 'Duplicate',
                          reason: {
                            label: 'Which report it duplicates',
                            placeholder: 'Same junction as the report from Tuesday',
                            required: true,
                          },
                        }}
                      />
                    </>
                  ) : (
                    <ActionButton
                      action={() => reviewMapReport(r.id, 'PENDING')}
                      label="Reopen"
                      icon="refresh"
                      variant="ghost"
                    />
                  )}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
