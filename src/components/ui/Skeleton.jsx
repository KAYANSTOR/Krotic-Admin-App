export function Skeleton({ className }) {
  return <div className={`skeleton ${className || ''}`} aria-hidden="true" />;
}

export function SkeletonLine({ className }) {
  return <div className={`skeleton skeleton-line ${className || ''}`} aria-hidden="true" />;
}

export function SkeletonStatGrid() {
  return (
    <div className="grid grid-cols-2 gap-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="card stat-card">
          <div className="flex-1 space-y-2">
            <SkeletonLine className="w-1/2" />
            <SkeletonLine className="w-2/3 h-6" />
          </div>
          <Skeleton className="w-10 h-10 rounded-[15px]" />
        </div>
      ))}
    </div>
  );
}

/** Mirrors the shared PageHeader so loading screens keep the same rhythm. */
export function SkeletonPageHeader() {
  return (
    <div className="page-header" aria-hidden="true">
      <div className="page-header__main">
        <Skeleton className="w-12 h-12 rounded-[16px]" />
        <div className="space-y-2">
          <SkeletonLine className="w-52 h-7" />
          <SkeletonLine className="w-40" />
        </div>
      </div>
    </div>
  );
}

/** Placeholder for a card with a title and a few lines of content. */
export function SkeletonCard({ lines = 3, className }) {
  return (
    <div className={`card space-y-4 ${className || ''}`} aria-hidden="true">
      <SkeletonLine className="w-1/3 h-6" />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine
          key={i}
          className={i % 2 === 0 ? 'w-full h-14 rounded-[14px]' : 'w-2/3 h-14 rounded-[14px]'}
        />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5 }) {
  return (
    <div className="divide-y divide-[#F1ECE7]">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-6 py-4">
          <Skeleton className="w-10 h-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <SkeletonLine className="w-1/3" />
            <SkeletonLine className="w-1/2" />
          </div>
          <SkeletonLine className="w-16" />
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-6">
      <SkeletonLine className="w-1/3 h-8" />
      <SkeletonStatGrid />
      <div className="card"><SkeletonTable rows={4} /></div>
    </div>
  );
}
