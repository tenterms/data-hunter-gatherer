import type { KeywordClusterPerformance } from "@/lib/types";

/**
 * Topical performance (by keyword): tracked-keyword ranking movements grouped
 * by the client's topic clusters.
 */
export default function KeywordClustersTable({ clusters }: { clusters: KeywordClusterPerformance[] }) {
  if (clusters.length === 0) {
    return (
      <p className="bars-empty">
        No tracked keywords matched the topic clusters this period (this section needs both ranking data
        and topic clusters to be set up).
      </p>
    );
  }
  const fmtPos = (p: number | null) => (p === null ? "–" : p.toFixed(1));
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Topic</th>
            <th className="num">Keywords</th>
            <th className="num">Up</th>
            <th className="num">Down</th>
            <th className="num">New</th>
            <th className="num">Avg pos</th>
            <th>Best mover</th>
          </tr>
        </thead>
        <tbody>
          {clusters.map((c) => (
            <tr key={c.key}>
              <td>
                <strong>{c.name}</strong>
              </td>
              <td className="num">{c.tracked}</td>
              <td className="num">
                <span className={c.up > 0 ? "change-positive" : "change-neutral"}>{c.up}</span>
              </td>
              <td className="num">
                <span className={c.down > 0 ? "change-negative" : "change-neutral"}>{c.down}</span>
              </td>
              <td className="num">
                <span className={c.entered > 0 ? "change-positive" : "change-neutral"}>{c.entered}</span>
              </td>
              <td className="num">
                {fmtPos(c.averagePosition.start)} → {fmtPos(c.averagePosition.end)}
              </td>
              <td>
                {c.bestMove ? (
                  <>
                    {c.bestMove.keyword}{" "}
                    {c.bestMove.direction === "entered" ? (
                      <span className="change-positive">entered at {c.bestMove.endPosition}</span>
                    ) : (
                      <span className="change-positive">
                        ↑ {c.bestMove.change} to {c.bestMove.endPosition}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="change-neutral">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
