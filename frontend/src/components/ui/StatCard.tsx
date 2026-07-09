import type { LucideIcon } from "lucide-react";
export function StatCard({ title, value, desc, Icon }: { title: string; value: string; desc?: string; Icon?: LucideIcon }) {
  return (
    <div className="stat bg-base-100 rounded-2xl shadow-sm">
      <div className="stat-figure text-primary">{Icon && <Icon className="w-8 h-8" />}</div>
      <div className="stat-title text-base-content/60">{title}</div>
      <div className="stat-value text-lg font-bold">{value}</div>
      {desc && <div className="stat-desc">{desc}</div>}
    </div>
  );
}
