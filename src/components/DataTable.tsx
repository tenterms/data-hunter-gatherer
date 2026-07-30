"use client";

import { useMemo, useState, type ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  /** numeric columns are right-aligned and sort numerically */
  numeric?: boolean;
  sortValue?: (row: T) => number | string;
  render: (row: T) => ReactNode;
}

/**
 * Generic sortable table. Click a header to sort; click again to flip
 * direction. Rows can optionally expand (used by the cannibalisation table).
 */
export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  expandable,
  defaultSortKey,
  defaultDescending = true,
  rowClassName,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  expandable?: (row: T) => ReactNode;
  defaultSortKey?: string;
  defaultDescending?: boolean;
  rowClassName?: (row: T) => string;
}) {
  const [sortKey, setSortKey] = useState<string | null>(defaultSortKey ?? null);
  const [descending, setDescending] = useState(defaultDescending);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const column = columns.find((c) => c.key === sortKey);
    if (!column?.sortValue) return rows;
    const sv = column.sortValue;
    return [...rows].sort((a, b) => {
      const va = sv(a);
      const vb = sv(b);
      let cmp: number;
      if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb));
      return descending ? -cmp : cmp;
    });
  }, [rows, columns, sortKey, descending]);

  const toggleSort = (key: string) => {
    if (sortKey === key) setDescending((d) => !d);
    else {
      setSortKey(key);
      setDescending(true);
    }
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {expandable && <th aria-label="expand" />}
            {columns.map((c) => (
              <th
                key={c.key}
                className={`${c.numeric ? "num " : ""}${c.sortValue ? "sortable" : ""}`}
                onClick={c.sortValue ? () => toggleSort(c.key) : undefined}
              >
                {c.header}
                {sortKey === c.key ? (descending ? " ↓" : " ↑") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const key = rowKey(row);
            const isOpen = expanded.has(key);
            return (
              <FragmentRow
                key={key}
                row={row}
                columns={columns}
                expandable={expandable}
                isOpen={isOpen}
                onToggle={() => toggleExpand(key)}
                className={rowClassName?.(row)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRow<T>({
  row,
  columns,
  expandable,
  isOpen,
  onToggle,
  className,
}: {
  row: T;
  columns: Column<T>[];
  expandable?: (row: T) => ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <>
      <tr className={className || undefined}>
        {expandable && (
          <td style={{ width: 28 }}>
            <button className="row-toggle" onClick={onToggle} aria-expanded={isOpen}>
              {isOpen ? "▾" : "▸"}
            </button>
          </td>
        )}
        {columns.map((c) => (
          <td key={c.key} className={c.numeric ? "num" : ""}>
            {c.render(row)}
          </td>
        ))}
      </tr>
      {expandable && isOpen && (
        <tr>
          <td colSpan={columns.length + 1}>{expandable(row)}</td>
        </tr>
      )}
    </>
  );
}
