'use client';

import { useState } from 'react';

import { ActionButton } from '@/components/ui/ActionButton';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/primitives';
import { reviewDriverDocument } from '@/lib/actions';
import type { Tone } from '@/lib/status';

export type DriverDocument = {
  id: string;
  type: string;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'MISSING' | string;
  url?: string;
  rejectionReason?: string;
};

const LABEL: Record<string, string> = {
  DRIVERS_LICENSE: "Driver's licence",
  GHANA_CARD: 'Ghana Card',
  PROFILE_PHOTO: 'Profile photo',
};

const STATUS: Record<string, { label: string; tone: Tone }> = {
  VERIFIED: { label: 'Verified', tone: 'accent' },
  PENDING: { label: 'Awaiting review', tone: 'warn' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  MISSING: { label: 'Not uploaded', tone: 'neutral' },
};

/**
 * The approval workflow, one document at a time.
 *
 * The image is shown at a usable size and opens full-size on click, because
 * approving a licence you cannot actually read is the failure mode this screen
 * exists to prevent. Rejection demands a reason — that text is what the driver
 * sees, so "rejected" with no explanation just produces a support ticket and a
 * re-upload of the same photo.
 */
export function DocumentReview({
  driverId,
  documents,
  canReview,
}: {
  driverId: string;
  documents: DriverDocument[];
  canReview: boolean;
}) {
  const [preview, setPreview] = useState<DriverDocument | null>(null);

  return (
    <>
      <ul className="divide-y divide-line">
        {documents.map((doc) => {
          const meta = STATUS[doc.status] ?? { label: doc.status, tone: 'neutral' as Tone };
          const label = LABEL[doc.type] ?? doc.type.replace(/_/g, ' ');
          const hasImage = !!doc.url;

          return (
            <li key={doc.id} className="p-4 flex flex-col sm:flex-row gap-4">
              {/* Thumbnail */}
              {hasImage ? (
                <button
                  type="button"
                  onClick={() => setPreview(doc)}
                  className="relative w-full sm:w-[132px] h-[92px] rounded-md overflow-hidden bg-surface-3 border border-line flex-none group focus-visible:outline-accent"
                  aria-label={`View ${label} full size`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={doc.url}
                    alt=""
                    className="w-full h-full object-cover transition-transform group-hover:scale-[1.03]"
                  />
                  <span className="absolute inset-0 grid place-items-center bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity text-white">
                    <Icon name="eye" size={17} />
                  </span>
                </button>
              ) : (
                <div className="w-full sm:w-[132px] h-[92px] rounded-md bg-surface-3 border border-dashed border-line-strong grid place-items-center flex-none text-text-faint">
                  <Icon name="scroll" size={19} />
                </div>
              )}

              {/* Detail + actions */}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <h3 className="t-heading">{label}</h3>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </div>

                {doc.status === 'REJECTED' && doc.rejectionReason ? (
                  <p className="t-small text-danger mb-2">
                    Rejected: {doc.rejectionReason}
                  </p>
                ) : null}

                {doc.status === 'MISSING' ? (
                  <p className="t-small text-text-faint mb-2">
                    The driver has not uploaded this yet. Nothing to review.
                  </p>
                ) : null}

                {canReview && hasImage ? (
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {doc.status !== 'VERIFIED' ? (
                      <ActionButton
                        action={() => reviewDriverDocument(driverId, doc.type, true)}
                        label="Approve"
                        icon="check"
                        variant="primary"
                        confirm={{
                          title: `Approve this ${label.toLowerCase()}?`,
                          body: 'Confirm the document is legible, unexpired and matches this driver.',
                          confirmLabel: 'Approve document',
                        }}
                      />
                    ) : null}
                    {doc.status !== 'REJECTED' ? (
                      <ActionButton
                        action={(reason) => reviewDriverDocument(driverId, doc.type, false, reason)}
                        label="Reject"
                        icon="x"
                        variant="danger"
                        confirm={{
                          title: `Reject this ${label.toLowerCase()}?`,
                          body: 'The driver is asked to upload a replacement.',
                          confirmLabel: 'Reject document',
                          reason: {
                            label: 'What is wrong with it?',
                            placeholder: 'e.g. Expired in March. Photo is also too blurred to read the number.',
                            required: true,
                          },
                        }}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        title={preview ? (LABEL[preview.type] ?? preview.type) : ''}
        description="Check it is legible, unexpired, and belongs to this driver."
        width={820}
      >
        {preview?.url ? (
          <div className="rounded-md overflow-hidden bg-bg-inset border border-line">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.url} alt={LABEL[preview.type] ?? preview.type} className="w-full h-auto" />
          </div>
        ) : null}
        <a
          href={preview?.url}
          target="_blank"
          rel="noreferrer"
          className="btn btn-secondary btn-sm mt-3"
        >
          <Icon name="external" size={13} />
          Open original
        </a>
      </Modal>
    </>
  );
}
