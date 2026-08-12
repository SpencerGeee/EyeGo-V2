'use client';

import { ActionButton } from '@/components/ui/ActionButton';
import { approveDriver, rejectDriver, suspendDriver } from '@/lib/actions';

/**
 * Which moderation actions apply depends on where the driver currently is.
 *
 * Offering every action at all times is how the wrong one gets clicked — there
 * is no meaning to "approve" a driver who is already approved, and showing it
 * greyed out just adds a control the operator has to reason about.
 */
export function DriverModeration({
  driverId,
  name,
  status,
}: {
  driverId: string;
  name: string;
  status: string;
}) {
  const pending = status === 'PENDING_REVIEW';
  const approved = status === 'APPROVED';
  const suspended = status === 'SUSPENDED';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {pending || suspended ? (
        <ActionButton
          action={() => approveDriver(driverId)}
          label={suspended ? 'Reinstate' : 'Approve'}
          icon="check"
          variant="primary"
          size="md"
          confirm={{
            title: suspended ? `Reinstate ${name}?` : `Approve ${name}?`,
            body: suspended
              ? 'They can go back online and accept trips immediately.'
              : 'Approve only once every compliance document below is verified. They can go online at once.',
            confirmLabel: suspended ? 'Reinstate driver' : 'Approve driver',
          }}
        />
      ) : null}

      {approved ? (
        <ActionButton
          action={(reason) => suspendDriver(driverId, reason)}
          label="Suspend"
          icon="ban"
          variant="danger"
          size="md"
          confirm={{
            title: `Suspend ${name}?`,
            body: 'They are taken offline at once and cannot accept trips until reinstated. Any trip already in progress is not cancelled by this.',
            confirmLabel: 'Suspend driver',
            reason: {
              label: 'Why are you suspending this driver?',
              placeholder: 'e.g. Three rider complaints about unsafe driving this week',
              required: true,
            },
          }}
        />
      ) : null}

      {pending ? (
        <ActionButton
          action={(reason) => rejectDriver(driverId, reason)}
          label="Reject application"
          icon="x"
          variant="danger"
          size="md"
          confirm={{
            title: `Reject ${name}'s application?`,
            body: 'They are told why and can re-apply with corrected documents.',
            confirmLabel: 'Reject application',
            reason: {
              label: 'Why is the application being rejected?',
              placeholder: 'e.g. Licence belongs to a different person than the Ghana Card',
              required: true,
            },
          }}
        />
      ) : null}
    </div>
  );
}
