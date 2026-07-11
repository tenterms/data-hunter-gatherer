import type { KpiCardData } from "@/lib/types";

export default function KpiCard({ kpi }: { kpi: KpiCardData }) {
  const changeClass =
    kpi.sentiment === "positive"
      ? "change-positive"
      : kpi.sentiment === "negative"
        ? "change-negative"
        : kpi.sentiment === "warning"
          ? "change-warning"
          : "change-neutral";
  return (
    <div className="kpi-card">
      <div className="label">{kpi.label}</div>
      <div className="value">{kpi.value}</div>
      {kpi.changeLabel && <div className={`change ${changeClass}`}>{kpi.changeLabel}</div>}
    </div>
  );
}
