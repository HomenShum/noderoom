import { useEffect, useState } from "react";

export interface CellEditorProps {
  elementId: string;
  value: unknown;
  version: number;
  editing: boolean;
  onCommit?: (nextValue: string) => void;
}

export function CellEditor({ value, editing, onCommit }: CellEditorProps) {
  const [draft, setDraft] = useState(String(value ?? ""));
  useEffect(() => setDraft(String(value ?? "")), [value]);
  if (!editing) return <span>{draft}</span>;
  return <input value={draft} onChange={(e) => setDraft(e.currentTarget.value)} onBlur={() => onCommit?.(draft.trim())} />;
}

