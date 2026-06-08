/** Public room chat (`.r-panel.center`) and private agent (`.r-panel.right`). Reads via useStore(). */
import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import { Lock, MessageCircle, Globe, Send, Sparkles, Copy, Check, ArrowUpRight, Pencil, Paperclip, X, Timer, RefreshCw } from "lucide-react";
import { useStore, type RoomStore } from "../app/store";
import type { Actor, Channel, Message } from "../engine/types";
import {
  encodeArtifactRefLine,
  hasDraggedArtifactRef,
  parseArtifactRefMessage,
  readDraggedArtifactRef,
  type ArtifactRef,
} from "./artifactRefs";

const COLORS = ["#d97757", "#5b9bf5", "#7bd089", "#a78bfa", "#e4c567", "#e8845f"];
function colorFor(store: RoomStore, roomId: string, a: Actor): string {
  if (a.kind === "agent") return "#d97757";
  return store.listMembers(roomId).find((m) => m.id === a.id)?.color ?? COLORS[0];
}
function initials(name: string): string {
  return name.replace(/[^A-Za-z ]/g, "").split(/[ ]/).filter(Boolean).map((s) => s[0]).slice(0, 2).join("").toUpperCase() || "?";
}
const clock = (ts: number) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const shortMs = (ms: number) => ms >= 60_000 ? `${Math.round(ms / 1000) / 60}m` : `${Math.round(ms / 100) / 10}s`;

const SLASH_CMDS = [
  { label: "/ask", insert: "/ask ", hint: "ask the Room NodeAgent to act on the sheet" },
  { label: "/free", insert: "/free ", hint: "queue the resumable free-auto job" },
  { label: "/ask reconcile Q3 revenue", insert: "/ask reconcile Q3 revenue against the NetSuite export", hint: "recompute the variance column" },
  { label: "/ask flag variance > 15%", insert: "/ask flag any variance over 15%", hint: "footnote the outliers" },
];

type ChatProps = {
  roomId: string;
  me: Actor;
  channel: Channel;
  variant: "public" | "private";
  agentName: string;
  style?: CSSProperties;
  onOpenArtifact?: (id: string) => void;
};

export function Chat({ roomId, me, channel, variant, agentName, style, onOpenArtifact }: ChatProps) {
  const store = useStore();
  const [text, setText] = useState("");
  const [refs, setRefs] = useState<ArtifactRef[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const nearBottom = useRef(true);
  const messages = store.listMessages(roomId, channel);
  const isPrivate = variant === "private";
  const longJob = isPrivate ? null : store.lastLongFreeJob();
  const longJobAttempts = isPrivate ? [] : store.lastLongFreeJobAttempts();
  const latestAttempt = longJobAttempts.at(-1);
  const canCancelLongJob = !!longJob && !["completed", "failed", "cancelled"].includes(longJob.status);
  const canRetryLongJob = !!longJob && ["failed", "blocked", "cancelled", "paused", "retrying"].includes(longJob.status);

  useEffect(() => { const el = feedRef.current; if (el && nearBottom.current) el.scrollTop = el.scrollHeight; }, [messages.length, thinking]);
  const onScroll = () => { const el = feedRef.current; if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };

  const grow = () => { const el = taRef.current; if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 120) + "px"; } };

  const send = (raw?: string) => {
    const t = (raw ?? text).trim();
    if (!t && refs.length === 0) return;
    const messageRefs = refs;
    const messageText = refs.length ? `${encodeArtifactRefLine(refs)}${t ? "\n\n" + t : ""}` : t;
    store.postMessage({ roomId, channel, author: me, text: messageText, clientMsgId: crypto.randomUUID(), kind: "chat" });
    setText(""); setRefs([]); setSlashOpen(false);
    requestAnimationFrame(grow);

    if (!isPrivate && /^\/ask\b/i.test(t)) {
      const goal = t.replace(/^\/ask\s*/i, "").trim() || "Recompute the Q3 variance from the audited NetSuite numbers.";
      setThinking(true);
      void store.askAgent({ goal, references: messageRefs }).finally(() => setThinking(false));
      return;
    }

    if (!isPrivate && /^\/free\b/i.test(t)) {
      const goal = t.replace(/^\/free\s*/i, "").trim() || "Recompute the Q3 variance from the audited NetSuite numbers.";
      setThinking(true);
      void store.startLongFreeAgent({ goal, references: messageRefs }).finally(() => setThinking(false));
      return;
    }

    if (isPrivate && store.mode === "memory") {
      const reduced = window.matchMedia?.("(prefers-reduced-motion:reduce)").matches ?? false;
      setThinking(true);
      setTimeout(() => {
        setThinking(false);
        const aware = store.awareness(roomId, "agent_priv");
        store.postMessage({
          roomId,
          channel,
          author: { kind: "agent", id: "agent_priv", name: agentName, scope: "private", ownerId: me.id },
          text: aware.activeLocks.length
            ? `I see ${aware.activeLocks.length} active lock(s). I'll read those ranges as context and draft around them. This stays private until you promote it.`
            : "Reading the room context for that. This stays private to you until you promote it.",
          clientMsgId: crypto.randomUUID(),
          kind: "agent",
        });
      }, reduced ? 0 : 900);
    }
  };

  const promote = (t: string) => {
    store.postMessage({ roomId, channel: "public", author: me, text: `Sharing from my NodeAgent - ${t}`, clientMsgId: crypto.randomUUID(), kind: "chat" });
  };

  const applySlash = (insert: string) => { setText(insert); setSlashOpen(false); requestAnimationFrame(() => { grow(); taRef.current?.focus(); }); };
  const addRef = (ref: ArtifactRef) => {
    const art = store.listArtifacts(roomId).find((a) => a.id === ref.id);
    if (!art) return;
    const canonical = { id: art.id, title: art.title, kind: art.kind };
    setRefs((cur) => cur.some((r) => r.id === canonical.id) ? cur : [...cur, canonical]);
  };
  const removeRef = (id: string) => setRefs((cur) => cur.filter((r) => r.id !== id));

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedArtifactRef(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!isNode(e.relatedTarget) || !e.currentTarget.contains(e.relatedTarget)) setDropActive(false);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedArtifactRef(e.dataTransfer)) return;
    e.preventDefault();
    setDropActive(false);
    const ref = readDraggedArtifactRef(e.dataTransfer);
    if (ref) addRef(ref);
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value; setText(v); grow();
    setSlashOpen(!isPrivate && v.trimStart() === "/");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen && e.key === "Tab") { e.preventDefault(); applySlash(SLASH_CMDS[0].insert); return; }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    else if (e.key === "Escape") { if (slashOpen) setSlashOpen(false); else taRef.current?.blur(); }
  };

  return (
    <div
      className={"r-panel " + (isPrivate ? "right" : "center")}
      style={style}
      data-drop={String(dropActive)}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="r-panel-head">
        {isPrivate ? <Lock size={14} /> : <MessageCircle size={14} />}
        <span className="h-title">{isPrivate ? "Your NodeAgent" : "Public chat"}</span>
        <span className={"r-tag " + (isPrivate ? "private" : "public")}>{isPrivate ? <><Lock size={10} /> Private</> : <><Globe size={10} /> Everyone</>}</span>
        <span className="grow" />
        {!isPrivate && <span className="r-tag agent" style={{ gap: 6 }}><span className="r-avatar agent sm" style={{ background: "#d97757", width: 18, height: 18, fontSize: 9 }}>N</span>Room NodeAgent</span>}
        {longJob && <span className="r-tag" title="Latest long-running free-auto job"><Timer size={10} /> {longJob.status} {longJob.attempts}/{longJob.maxAttempts}</span>}
        {canCancelLongJob && (
          <button className="r-iconbtn" style={{ width: 24, height: 24 }} title="Cancel long-running job" onClick={() => void store.cancelLongFreeJob(longJob.id)}>
            <X size={13} />
          </button>
        )}
        {canRetryLongJob && (
          <button className="r-iconbtn" style={{ width: 24, height: 24 }} title="Retry long-running job" onClick={() => void store.retryLongFreeJob(longJob.id)}>
            <RefreshCw size={13} />
          </button>
        )}
      </div>
      {isPrivate && <div className="r-private-banner"><Sparkles size={12} /> Reads room context; output stays yours until you promote it</div>}
      {!isPrivate && longJob && (
        <div className="r-job-strip">
          <Timer size={12} />
          <span>{longJob.modelPolicy}</span>
          {latestAttempt && <span>attempt {latestAttempt.attempt}: {latestAttempt.resolvedModel} · {latestAttempt.stopReason} · {shortMs(latestAttempt.ms)}</span>}
          {longJob.nextRunAt && longJob.status !== "completed" && <span>next {clock(longJob.nextRunAt)}</span>}
          {longJob.error && <span>{longJob.error}</span>}
        </div>
      )}

      <div className="r-chat" ref={feedRef} onScroll={onScroll} aria-live="polite">
        {messages.length === 0 && <div className="tiny faint" style={{ margin: "auto" }}>No messages yet. Say hello.</div>}
        {messages.map((m) => <Bubble key={m.id} m={m} roomId={roomId} variant={variant} me={me} onPromote={promote} onOpenArtifact={onOpenArtifact} />)}
        {thinking && (
          <div className="r-msg agent" aria-label={`${agentName} is thinking`}>
            <span className="r-avatar agent sm" style={{ background: "#d97757" }}>N</span>
            <div className="body">
              <div className="meta"><span className="who">{agentName}</span><span className="r-tag agent" style={{ padding: "1px 5px", fontSize: 9 }}>thinking</span></div>
              <div className="r-typing"><i /><i /><i /></div>
            </div>
          </div>
        )}
      </div>

      <div className="r-composer">
        {slashOpen && (
          <div className="r-slash" role="listbox" aria-label="Commands">
            {SLASH_CMDS.map((c) => (
              <button key={c.label} className="r-slash-item" role="option" aria-selected="false" onMouseDown={(e) => { e.preventDefault(); applySlash(c.insert); }}>
                <span className="cmd">{c.label}</span><span className="hint">{c.hint}</span>
              </button>
            ))}
          </div>
        )}
        {refs.length > 0 && (
          <div className="r-ref-composer" aria-label="Message references">
            {refs.map((ref) => (
              <span key={ref.id} className="r-ref-chip">
                <button className="r-ref-open" type="button" onClick={() => onOpenArtifact?.(ref.id)}>
                  <Paperclip size={12} /> {ref.title}
                </button>
                <button className="r-ref-remove" type="button" aria-label={`Remove ${ref.title}`} onClick={() => removeRef(ref.id)}><X size={11} /></button>
              </span>
            ))}
          </div>
        )}
        <div className="r-input-wrap">
          <textarea ref={taRef} rows={1} value={text} onChange={onChange} onKeyDown={onKeyDown}
            placeholder={isPrivate ? "Ask privately..." : "Message the room... type / for commands"}
            aria-label={isPrivate ? "Ask privately" : "Message the room"} />
          <button className="r-send" onClick={() => send()} aria-label="Send message"><Send size={15} /></button>
        </div>
        {!isPrivate && !slashOpen && (
          <div className="r-composer-hint">
            <button className="r-chip" onClick={() => applySlash(SLASH_CMDS[1].insert)}>/ask reconcile Q3 revenue</button>
            <button className="r-chip" onClick={() => applySlash(SLASH_CMDS[2].insert)}>/ask flag variance &gt; 15%</button>
            <span className="r-composer-kbd" aria-hidden="true">Enter sends; Shift+Enter newline; / commands</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Bubble({ m, roomId, variant, me, onPromote, onOpenArtifact }: { m: Message; roomId: string; variant: "public" | "private"; me: Actor; onPromote: (t: string) => void; onOpenArtifact?: (id: string) => void }) {
  const store = useStore();
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.text);
  const parsed = parseArtifactRefMessage(m.text);
  const agent = m.author.kind === "agent";
  const ask = !agent && parsed.body.trim().startsWith("/ask");
  const mine = !agent && m.author.id === me.id;
  const canPromote = agent && variant === "private";
  const copy = () => { void navigator.clipboard?.writeText(m.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); };
  const saveEdit = () => { const t = draft.trim(); if (t && t !== m.text) store.editMessage(m.id, t, me); setEditing(false); };

  return (
    <div className={"r-msg" + (agent ? " agent" : "")}>
      <span className={"r-avatar sm" + (agent ? " agent" : "")} style={{ background: colorFor(store, roomId, m.author) }}>{agent ? "N" : initials(m.author.name)}</span>
      <div className="body">
        <div className="meta">
          <span className="who">{m.author.name}</span>
          {agent && <span className="r-tag agent" style={{ padding: "1px 5px", fontSize: 9 }}>agent</span>}
          <span className="time">{clock(m.createdAt)}</span>
        </div>
        {editing ? (
          <div className="r-input-wrap" style={{ marginTop: 4 }}>
            <textarea autoFocus rows={1} value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); } else if (e.key === "Escape") { setDraft(m.text); setEditing(false); } }}
              aria-label="Edit message" />
          </div>
        ) : (
          <>
            {parsed.refs.length > 0 && (
              <div className="r-msg-refs">
                {parsed.refs.map((ref) => (
                  <button key={ref.id} className="r-msg-ref" type="button" onClick={() => onOpenArtifact?.(ref.id)}>
                    <Paperclip size={11} /> {ref.title}
                  </button>
                ))}
              </div>
            )}
            {parsed.body && (ask ? <span className="r-bubble-ask">{parsed.body}</span> : <div className="text">{parsed.body}</div>)}
          </>
        )}

        {editing ? (
          <div className="r-msg-actions" style={{ opacity: 1 }}>
            <button className="r-msg-act promote" onClick={saveEdit}>Save</button>
            <button className="r-msg-act" onClick={() => { setDraft(m.text); setEditing(false); }}>Cancel</button>
          </div>
        ) : (
          <div className="r-msg-actions">
            <button className="r-msg-act" onClick={copy} aria-label="Copy message">{copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}</button>
            {mine && <button className="r-msg-act" onClick={() => { setDraft(m.text); setEditing(true); }} aria-label="Edit message"><Pencil size={12} /> Edit</button>}
            {canPromote && <button className="r-msg-act promote" onClick={() => onPromote(m.text)} aria-label="Promote to the public chat"><ArrowUpRight size={12} /> Promote to public</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function isNode(value: EventTarget | null): value is Node {
  return value instanceof Node;
}
