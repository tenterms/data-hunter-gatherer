import type { Comparison } from "@/lib/types";

/**
 * Red/green/neutral change indicator: "↑ 20%", "↓ 38%", "→ 0%", or "new"
 * when the previous value was 0 (never Infinity).
 */
export default function ChangeBadge({
  comparison,
  invert = false,
}: {
  comparison: Comparison;
  invert?: boolean;
}) {
  if (comparison.isNew) {
    return <span className="change-positive">↑ new</span>;
  }
  const pct = comparison.changePct;
  if (pct === null || pct === 0) {
    return <span className="change-neutral">→ 0%</span>;
  }
  const goodDirection = invert ? pct < 0 : pct > 0;
  const arrow = pct > 0 ? "↑" : "↓";
  const cls = goodDirection ? "change-positive" : "change-negative";
  return (
    <span className={cls}>
      {arrow} {Math.abs(pct * 100).toFixed(0)}%
    </span>
  );
}
