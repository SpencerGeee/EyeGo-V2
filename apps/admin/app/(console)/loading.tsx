/**
 * Shown while a console page's server reads are in flight.
 *
 * Deliberately a skeleton of the shape every page shares — a header line, a KPI
 * row, a table block — rather than a spinner. The layout does not jump when the
 * real content lands, and the operator can already see which region is about to
 * fill in. `.skeleton` drops its animation under prefers-reduced-motion.
 */
export default function ConsoleLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>

      <div className="mb-5">
        <div className="skeleton h-6 w-[220px] mb-2" />
        <div className="skeleton h-3.5 w-[320px]" />
      </div>

      <div className="grid gap-3 mb-4 grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card p-4">
            <div className="skeleton h-3 w-[70px] mb-3" />
            <div className="skeleton h-6 w-[90px]" />
          </div>
        ))}
      </div>

      <div className="card-flush">
        <div className="card-head">
          <div className="skeleton h-4 w-[140px]" />
        </div>
        <div className="p-4 space-y-2.5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton h-9 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
