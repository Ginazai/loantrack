import { SkeletonPlaceholder, SkeletonText } from "@carbon/react";

/** Placeholder with the same structure as `StatCard`, so the grid doesn't shift on load. */
export function StatCardSkeleton() {
  return (
    <div className="lt-kpi" aria-hidden="true">
      <div className="lt-kpi__head">
        <SkeletonText width="45%" />
        <SkeletonPlaceholder className="lt-kpi__sk-icon" />
      </div>
      <div>
        <SkeletonText heading width="65%" />
        <SkeletonText width="40%" />
      </div>
    </div>
  );
}
