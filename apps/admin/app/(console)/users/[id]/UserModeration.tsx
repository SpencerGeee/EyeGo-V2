'use client';

import { ActionButton } from '@/components/ui/ActionButton';
import { banUser, unbanUser } from '@/lib/actions';

/**
 * Only ever offer the one action that applies. A banned rider has nothing to
 * ban, and a rider in good standing has nothing to reinstate — showing both and
 * disabling one just adds a control the operator has to reason about.
 */
export function UserModeration({
  userId,
  name,
  isBanned,
}: {
  userId: string;
  name: string;
  isBanned: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {isBanned ? (
        <ActionButton
          action={() => unbanUser(userId)}
          label="Reinstate"
          icon="check"
          variant="secondary"
          size="md"
          confirm={{
            title: `Reinstate ${name}?`,
            body: 'They can book seats again immediately. Their booking history is unchanged.',
            confirmLabel: 'Reinstate rider',
          }}
        />
      ) : (
        <ActionButton
          action={(reason) => banUser(userId, reason)}
          label="Ban rider"
          icon="ban"
          variant="danger"
          size="md"
          confirm={{
            title: `Ban ${name}?`,
            body: 'They cannot book a new seat or sign in. Seats they already hold on an upcoming trip are NOT released — cancel those separately if the trip has not run.',
            confirmLabel: 'Ban rider',
            reason: {
              label: 'Why is this rider being banned?',
              placeholder: 'e.g. Repeated no-shows on paid seats, three drivers reported abuse',
              required: true,
            },
          }}
        />
      )}
    </div>
  );
}
