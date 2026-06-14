import type { CSSProperties } from "react";
import { CellEditor } from "./CellEditor";

export interface SmartGridColumn {
  id: string;
  label: string;
  agentWritable: boolean;
}

export interface SmartGridRow {
  id: string;
  cells: Record<string, string>;
}

export interface SmartGridProps {
  columns: SmartGridColumn[];
  rows?: SmartGridRow[];
  rowCount?: number;
  onCommit?: (rowId: string, columnId: string, value: string) => void;
  style?: CSSProperties;
}

export function SmartGrid({ columns, rows = [], rowCount = rows.length, onCommit, style }: SmartGridProps) {
  const tableRows: SmartGridRow[] = rows.length
    ? rows
    : Array.from({ length: rowCount }, (_, index): SmartGridRow => ({ id: `row-${index + 1}`, cells: {} }));
  return (
    <div style={{ overflowX: "auto", ...style }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>{columns.map((column) => <th key={column.id} style={{ textAlign: "left", borderBottom: "1px solid rgba(148,163,184,.28)", padding: 8 }}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {tableRows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => (
                <td key={column.id} style={{ borderBottom: "1px solid rgba(148,163,184,.12)", padding: 8 }}>
                  {column.agentWritable
                    ? <CellEditor elementId={`${row.id}__${column.id}`} value={row.cells[column.id] ?? ""} version={0} editing={true} onCommit={(value) => onCommit?.(row.id, column.id, value)} />
                    : (row.cells[column.id] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
