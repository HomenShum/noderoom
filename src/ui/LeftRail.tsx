/** Left rail (`.r-panel.left`): Room header · Files (subtitles) · People (roles + live dots). lucide icons. */
import { useRef, useState, type CSSProperties, type DragEvent } from "react";
import { FolderOpen, Table2, FileText, StickyNote, Database, BookOpen, Upload, type LucideIcon } from "lucide-react";
import { useStore, type UploadedArtifactInput } from "../app/store";
import type { Actor } from "../engine/types";
import { ARTIFACT_REF_MIME, encodeArtifactRef } from "./artifactRefs";
import { isExcelWorkbook, isSpreadsheetFile, parseSpreadsheetArtifacts } from "../app/spreadsheetParser";
import { documentParsePlan, guessDocumentMimeType } from "../app/documentParserPlan";

const WIKI_TITLE = "Agent wiki";
const MAX_INLINE_PREVIEW_BYTES = 750_000;
const MAX_SPREADSHEET_BYTES = 5_000_000;

function initials(name: string): string {
  return name.replace(/[^A-Za-z· ]/g, "").split(/[ ·]/).filter(Boolean).map((s) => s[0]).slice(0, 2).join("").toUpperCase() || "?";
}
const fileIcon = (a: { kind: string; title: string }): LucideIcon => (a.title === WIKI_TITLE ? BookOpen : a.kind === "sheet" ? Table2 : a.kind === "note" ? FileText : StickyNote);
function roleOf(name: string, role: string, anon: boolean): string {
  if (role === "host") return "Host";
  if (name === "Priya") return "Finance lead";
  return anon ? "Guest" : "Member";
}

export function LeftRail({ roomId, me, artId, onPick, style }: { roomId: string; me: Actor; artId: string; onPick: (id: string) => void; style?: CSSProperties }) {
  const store = useStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const arts = store.listArtifacts(roomId);
  const members = store.listMembers(roomId);
  const sessions = store.listSessions(roomId);
  const sub = (a: { kind: string; title: string; version: number; elements: Record<string, unknown>; order?: string[]; meta?: { excelGrid?: { rows: number; columns: number } } }) =>
    a.title === WIKI_TITLE ? `v${a.version} · live TOC` : uploadDocMeta(a) ?? (a.kind === "sheet" ? `v${a.version} · ${rowCount(a)} rows` : a.kind === "wall" ? `${Object.keys(a.elements).length} notes` : "edited recently");
  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setUploadError(null);
    try {
      let lastId = "";
      for (const file of Array.from(files)) {
        const artifacts = await artifactsFromFile(file);
        for (const artifact of artifacts) lastId = await store.uploadArtifact({ roomId, artifact, actor: me });
      }
      if (lastId) onPick(lastId);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="r-panel left" style={style} data-testid="left-rail">
      <div className="r-panel-head"><FolderOpen size={15} /><span className="h-title">Room</span></div>
      <div className="r-rail">
        <div className="r-rail-section">
          <div className="kicker" style={{ padding: "2px 9px 8px" }}>Files</div>
          {arts.map((a) => {
            const FI = fileIcon(a);
            return (
              <button
                key={a.id}
                className="r-file"
                data-active={String(a.id === artId)}
                draggable
                title="Drag into chat to reference this file"
                onClick={() => onPick(a.id)}
                onDragStart={(e) => dragArtifactRef(e, a)}
              >
                <span className="fi"><FI size={14} /></span>
                <span style={{ minWidth: 0 }}><div className="fn">{a.title}</div><div className="fm">{sub(a)}</div></span>
              </button>
            );
          })}
          <input ref={inputRef} className="r-file-input" type="file" multiple onChange={(e) => void onUpload(e.currentTarget.files)} />
          <button className="r-file r-upload" disabled={uploading} onClick={() => inputRef.current?.click()}>
            <span className="fi"><Upload size={14} /></span>
            <span style={{ minWidth: 0 }}><div className="fn">{uploading ? "Uploading..." : "Upload file"}</div><div className="fm">CSV, XLSX, text, image, PDF</div></span>
          </button>
          {uploadError && <div className="r-upload-error">{uploadError}</div>}
          {/* Inert reference row — r-file-static strips the clickable hover affordance it was
              borrowing from the real artifact buttons above (looks-clickable-must-act rule). */}
          <div className="r-file r-file-static">
            <span className="fi"><Database size={14} /></span>
            <span><div className="fn">NetSuite export</div><div className="fm">source · read-only</div></span>
          </div>
        </div>

        <div className="r-rail-section">
          <div className="kicker" style={{ padding: "2px 9px 8px" }}>People · {members.length} live</div>
          {members.map((m) => (
            <div key={m.id} className="r-person">
              <span className="r-avatar sm" style={{ background: m.color }}>{initials(m.name)}</span>
              <span className="grow"><div className="pn">{m.name}</div><div className="pr">{roleOf(m.name, m.role, m.anon)}</div></span>
              <span className="r-dot-live" />
            </div>
          ))}
          {sessions.filter((s) => s.scope === "public").map((s) => (
            <div key={s.id} className="r-person">
              <span className="r-avatar agent sm" style={{ background: "#d97757" }}>◆</span>
              <span className="grow"><div className="pn">{s.agentName}</div><div className="pr">Public agent · {s.status}</div></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function dragArtifactRef(e: DragEvent<HTMLButtonElement>, artifact: { id: string; title: string; kind: string }) {
  const ref = { id: artifact.id, title: artifact.title, kind: artifact.kind };
  e.dataTransfer.effectAllowed = "copy";
  e.dataTransfer.setData(ARTIFACT_REF_MIME, JSON.stringify(ref));
  e.dataTransfer.setData("text/plain", encodeArtifactRef(ref));
}

function rowCount(a: { order?: string[]; meta?: { excelGrid?: { rows: number } } }) {
  if (a.meta?.excelGrid) return a.meta.excelGrid.rows;
  const ids: string[] = [];
  for (const id of a.order ?? []) {
    const row = id.split("__")[0];
    if (!ids.includes(row)) ids.push(row);
  }
  return ids.length;
}

function uploadDocMeta(a: { kind: string; elements: Record<string, unknown> }) {
  if (a.kind !== "note") return null;
  const doc = (a.elements.doc as { value?: unknown } | undefined)?.value;
  if (!isUploadDoc(doc)) return null;
  return `${doc.mimeType || "file"} · ${formatBytes(doc.size)}`;
}

type UploadDoc = {
  upload: true;
  fileName: string;
  mimeType: string;
  size: number;
  text?: string;
  dataUrl?: string;
  parse?: ReturnType<typeof documentParsePlan>;
};

function isUploadDoc(value: unknown): value is UploadDoc {
  return !!value && typeof value === "object" && (value as { upload?: unknown }).upload === true;
}

async function artifactsFromFile(file: File): Promise<UploadedArtifactInput[]> {
  const lower = file.name.toLowerCase();
  const mimeType = file.type || guessMimeType(lower);
  if (isSpreadsheetFile(file.name, mimeType)) {
    if (file.size > MAX_SPREADSHEET_BYTES) throw new Error(`${file.name} is too large for browser spreadsheet parsing (${formatBytes(MAX_SPREADSHEET_BYTES)} max).`);
    if (isExcelWorkbook(file.name, mimeType)) {
      return parseSpreadsheetArtifacts({ fileName: file.name, mimeType, size: file.size, arrayBuffer: await file.arrayBuffer() });
    }
    const text = await file.text();
    return parseSpreadsheetArtifacts({ fileName: file.name, mimeType, size: file.size, text, delimiter: lower.endsWith(".tsv") ? "\t" : "," });
  }
  if (file.size > MAX_INLINE_PREVIEW_BYTES) throw new Error(`${file.name} is too large for inline room preview (${formatBytes(MAX_INLINE_PREVIEW_BYTES)} max).`);
  const textLike = mimeType.startsWith("text/") || /(\.md|\.json|\.log)$/i.test(file.name);
  const parse = documentParsePlan(file.name, mimeType);
  const doc: UploadDoc = { upload: true, fileName: file.name, mimeType, size: file.size, parse };
  if (textLike) doc.text = await file.text();
  else doc.dataUrl = await readAsDataUrl(file);
  return [{ kind: "note", title: file.name, seed: [{ id: "doc", value: doc }], meta: { upload: { fileName: file.name, mimeType, size: file.size, parsedAt: Date.now() }, document: parse } }];
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

function guessMimeType(name: string) {
  const documentMime = guessDocumentMimeType(name);
  if (documentMime) return documentMime;
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 104_857.6) / 10} MB`;
}
