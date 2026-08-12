import type { Metadata } from 'next';

import { PromotionsManager, type Promotion } from './PromotionsManager';
import { RefreshControl } from '@/components/ui/Filters';
import { Card, ErrorPanel, PageHeader } from '@/components/ui/primitives';
import { apiGetSafe, getAdmin } from '@/lib/api';
import { can, isReadOnly } from '@/lib/roles';

export const metadata: Metadata = { title: 'Promotions' };

export default async function PromotionsPage() {
  const [data, admin] = await Promise.all([
    apiGetSafe<{ promotions: Promotion[] }>('/promotions'),
    getAdmin(),
  ]);

  return (
    <>
      <PageHeader
        title="Promotions"
        subtitle="Discount codes riders can apply at checkout. A live code costs real money on every redemption."
        actions={<RefreshControl />}
      />

      {!data ? (
        <Card>
          <ErrorPanel message="The promotions endpoint did not respond." />
        </Card>
      ) : (
        <PromotionsManager
          promotions={data.promotions}
          canManage={can(admin?.role, ['FINANCE']) && !isReadOnly(admin?.role)}
          readOnlyReason={
            can(admin?.role, ['FINANCE'])
              ? 'Your role is read-only.'
              : 'Only Finance can create or disable promotions.'
          }
        />
      )}
    </>
  );
}
