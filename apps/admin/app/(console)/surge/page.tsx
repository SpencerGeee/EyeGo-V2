import type { Metadata } from 'next';

import { SurgeForm } from './SurgeForm';
import { Card, CardBody, CardHead, PageHeader, ReadOnlyNote } from '@/components/ui/primitives';
import { getAdmin } from '@/lib/api';
import { can, isReadOnly } from '@/lib/roles';

export const metadata: Metadata = { title: 'Surge' };

/**
 * Surge override.
 *
 * A known gap, stated plainly rather than papered over: the API has no endpoint
 * that lists zones, so this page cannot offer a picker and the operator has to
 * know the zone id. Inventing a hardcoded zone list in the console would look
 * complete and then silently disagree with whatever the pricing service actually
 * uses, which is worse than asking.
 *
 * Overrides expire on their own after one hour — that is the API's behaviour, and
 * it is stated on screen because an override that quietly lapses is otherwise
 * indistinguishable from one that never applied.
 */
export default async function SurgePage() {
  const admin = await getAdmin();
  const canSet = can(admin?.role, ['OPS']) && !isReadOnly(admin?.role);

  return (
    <>
      <PageHeader
        title="Surge"
        subtitle="Temporarily multiply fares in a zone to pull supply toward demand."
      />

      <div className="grid gap-4 lg:grid-cols-2 max-w-[900px]">
        <Card>
          <CardHead title="Set an override" icon="bolt" />
          <CardBody>
            {canSet ? (
              <SurgeForm />
            ) : (
              <ReadOnlyNote>
                {can(admin?.role, ['OPS'])
                  ? 'Your role is read-only.'
                  : 'Only Operations can change surge pricing.'}
              </ReadOnlyNote>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHead title="How this behaves" icon="info" />
          <CardBody>
            <ul className="space-y-2.5 t-small text-text-dim">
              <li>
                <strong className="text-text">Overrides expire after one hour.</strong> The API sets a
                60-minute TTL. If demand is still high you must set it again.
              </li>
              <li>
                <strong className="text-text">The maximum is 3.0x.</strong> The API caps anything
                higher, so a typo cannot become a pricing incident.
              </li>
              <li>
                <strong className="text-text">Setting 1.0 clears the override</strong> and returns the
                zone to normal pricing immediately.
              </li>
              <li>
                <strong className="text-text">Riders already quoted keep their price.</strong> A quote
                is locked when it is issued, so a surge change does not reprice a
                trip someone is midway through booking.
              </li>
              <li>
                <strong className="text-text">There is no zone directory yet.</strong> The API exposes
                no endpoint listing zone ids, so you need to know the id you are
                targeting. This is a genuine gap, not a missing dropdown.
              </li>
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
