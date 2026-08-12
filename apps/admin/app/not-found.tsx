import Link from 'next/link';

import { Icon } from '@/components/ui/Icon';

/**
 * Reached two ways: an unknown URL, and notFound() called from a detail page
 * whose record does not exist. The copy has to make sense for both, so it says
 * "page or record" rather than guessing.
 */
export default function NotFound() {
  return (
    <div className="min-h-dvh grid place-items-center p-6">
      <div className="card p-6 max-w-[460px] w-full">
        <span className="w-8 h-8 rounded-lg bg-surface-2 text-text-dim grid place-items-center mb-3">
          <Icon name="search" size={17} />
        </span>
        <h1 className="t-title mb-1">Not found</h1>
        <p className="t-body text-text-dim mb-4">
          That page or record does not exist. It may have been deleted, or the id in
          the address may be wrong.
        </p>
        <Link href="/" className="btn btn-primary btn-sm">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
