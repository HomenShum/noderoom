/**
 * RoomShell — top bar + the 4 peer panels. Reads everything through `useStore()`,
 * so it renders identically whether the data is the in-memory engine or live
 * Convex. The collaboration "Run" button calls `store.runCollab()` — the scripted
 * demo in-memory, the real `runRoomAgent` Convex action when live.
 */

import { useEffect, useState } from "react";
import { PanelLeft, Table2, PanelRight, Moon, Sun, LogOut, Link2, ShieldCheck, X, HelpCircle } from "lucide-react";
import { useStore } from "../app/store";
import { Chat } from "./Chat";
import { Artifact } from "./panels/Artifact";
import { LeftRail } from "./LeftRail";
import { GuidedTour, type TourStep } from "./GuidedTour";
import type { Actor, Channel } from "../engine/types";

const AUTO_ACCEPT_PREF_KEY = "noderoom:autoAcceptConsent:v1";
const TOUR_KEY = "noderoom:tour:v1";

function initials(name: string): string {
  return name.replace(/[^A-Za-z· ]/g, "").split(/[ ·]/).filter(Boolean).map((s) => s[0]).slice(0, 2).join("").toUpperCase() || "?";
}

export function RoomShell({ roomId, me, onLeave }: { roomId: string; me: Actor; onLeave: () => void }) {
  const store = useStore();
  const room = store.getRoom(roomId);
  const live = store.canRunCollab;
  const [show, setShow] = useState({ left: live, artifact: live, priv: live });
  const [layout, setLayout] = useState({ left: 224, center: 1.15, artifact: 1.35, right: 320 });
  const arts = store.listArtifacts(roomId);
  const [artId, setArtId] = useState(() => arts.find((a) => a.kind === "sheet")?.id ?? arts[0]?.id ?? "");
  const [collab, setCollab] = useState({ running: false, done: false });
  const [autoAcceptModal, setAutoAcceptModal] = useState(false);
  const [rememberAutoAccept, setRememberAutoAccept] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  // First-run: auto-start the walkthrough once in the seeded demo room. Persists a "seen" flag so a
  // returning visitor is never nagged; the header "?" button replays it on demand.
  useEffect(() => {
    if (!live) return;
    let seen = false;
    try { seen = localStorage.getItem(TOUR_KEY) === "done"; } catch { /* ignore */ }
    if (!seen) { setShow({ left: true, artifact: true, priv: true }); setTourOpen(true); }
  }, [live]);
  if (!room) return <div className="r-app"><div className="r-screen"><div style={{ margin: "auto" }} className="muted">Loading room…</div></div></div>;

  const members = store.listMembers(roomId);
  const isHost = members.some((m) => m.id === me.id && m.role === "host");
  const privChannel: Channel = { private: me.id };
  const curArt = arts.find((a) => a.id === artId) ?? arts.find((a) => a.kind === "sheet");
  const openArtifact = (id: string) => {
    if (!store.listArtifacts(roomId).some((a) => a.id === id)) return;
    setArtId(id);
    setShow((s) => ({ ...s, artifact: true }));
  };

  const varianceArt = arts.find((a) => a.title === "Q3 variance") ?? arts.find((a) => a.kind === "sheet");
  // Open the tour from a clean, known layout: all panels shown + the variance sheet selected, ONCE.
  // Steps then anchor only to always-visible elements, so there are no per-step side-effects to thrash.
  const startTour = () => {
    if (varianceArt) openArtifact(varianceArt.id);
    setShow({ left: true, artifact: true, priv: true });
    setTourOpen(true);
  };
  const tourSteps: TourStep[] = [
    {
      title: "Welcome to NodeRoom",
      body: "A live room where you and AI NodeAgents edit a shared spreadsheet, notes, and a post-it wall together — without ever clobbering each other. Here's the 60-second tour. You're in a safe demo: nothing is sent anywhere.",
      placement: "center",
    },
    {
      selector: '[data-testid="left-rail"]',
      title: "The shared room",
      body: "Every artifact lives here — a spreadsheet, notes, a research sheet, and a post-it wall — alongside the people and agents in the room.",
      placement: "right",
    },
    {
      selector: '.r-panel.center [data-testid="chat-composer"]',
      title: "Ask the room — or the agent",
      body: "Talk in plain language. Start a message with /ask to put the Room NodeAgent to work on the spreadsheet, e.g. /ask reconcile Q3 revenue.",
      placement: "top",
    },
    {
      selector: '[data-testid="collab-run"]',
      title: "Human + agent, no clobbering",
      body: "Click Run collaboration to watch the agent lock a range, draft around your edits, and smart-merge on unlock — a strict compare-and-swap, no-clobber model. Cells update instantly, no spinner.",
      placement: "left",
    },
    {
      selector: '[data-testid="room-trace"]',
      title: "Everything is auditable",
      body: "Every change — by hand or by agent — is recorded here. With Auto-allow off, agent edits arrive as proposals the host approves or rejects.",
      placement: "left",
    },
    {
      selector: '[data-testid="artifact-tabs"]',
      title: "Spreadsheet, notes & a post-it wall",
      body: "Switch tabs to the research sheet, the shared note, or the drag-and-drop post-it wall — every surface is live and conflict-safe.",
      placement: "bottom",
    },
    {
      selector: '.r-panel.right [data-testid="chat-composer"]',
      title: "Your private NodeAgent",
      body: "It reads the room for context, but its output stays yours until you Promote it to the public chat.",
      placement: "left",
    },
    {
      title: "Now you try",
      body: "Type /ask reconcile Q3 revenue in the public chat and watch the agent work — or hit Run collaboration. Replay this tour anytime from the ? button up top.",
      placement: "center",
    },
  ];

  const runCollab = async () => {
    if (collab.running) return;
    setShow({ left: true, artifact: true, priv: true });
    setCollab({ running: true, done: false });
    try { await store.runCollab(); } finally { setCollab({ running: false, done: true }); }
  };
  const toggleAutoAccept = () => {
    if (!isHost) return;
    if (room.autoAllow) {
      store.toggleAutoAllow(roomId, me);
      return;
    }
    if (localStorage.getItem(AUTO_ACCEPT_PREF_KEY) === "host-consented") {
      store.toggleAutoAllow(roomId, me);
      return;
    }
    setRememberAutoAccept(false);
    setAutoAcceptModal(true);
  };
  const confirmAutoAccept = () => {
    if (rememberAutoAccept) localStorage.setItem(AUTO_ACCEPT_PREF_KEY, "host-consented");
    setAutoAcceptModal(false);
    store.toggleAutoAllow(roomId, me);
  };
  const startResize = (target: "left" | "middle" | "right", startX: number) => {
    const start = layout;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      setLayout((cur) => {
        if (target === "left") return { ...cur, left: clamp(start.left + dx, 176, 380) };
        if (target === "right") return { ...cur, right: clamp(start.right - dx, 240, 520) };
        const delta = dx / 220;
        const center = clamp(start.center + delta, 0.7, 2.4);
        const artifact = clamp(start.artifact - delta, 0.8, 2.8);
        return { ...cur, center, artifact };
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("r-resizing");
    };
    document.body.classList.add("r-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="r-app">
      <div className="r-top">
        <div className="r-mark">N</div>
        <div className="r-brand">NodeRoom <span>· {room.title}</span></div>
        <div className="r-roomcode"><Link2 size={12} /> code <b>{room.code}</b></div>
        {store.mode === "convex" && <span className="r-tag" style={{ background: "rgba(31,138,91,.16)", color: "#2E9E6B" }}>● live convex</span>}
        {store.mode === "memory" && <span className="r-tag r-demo-badge" title="Scripted demo — no backend or API keys needed; everything runs locally and offline.">● demo</span>}
        <span className="r-spacer" />
        <div className="r-toggle-group">
          <button className="r-iconbtn" data-on={String(show.left)} title="Files & people" onClick={() => setShow((s) => ({ ...s, left: !s.left }))}><PanelLeft size={16} /></button>
          <button className="r-iconbtn" data-on={String(show.artifact)} title="Artifact" onClick={() => setShow((s) => ({ ...s, artifact: !s.artifact }))}><Table2 size={16} /></button>
          <button className="r-iconbtn" data-on={String(show.priv)} title="Private agent" onClick={() => setShow((s) => ({ ...s, priv: !s.priv }))}><PanelRight size={16} /></button>
        </div>
        <div className="r-pill-auto">
          Auto-allow
          <button className="r-switch" data-on={String(room.autoAllow)} disabled={!isHost} title={isHost ? "Auto-approve agent edits" : "Only the host can change auto-allow"} onClick={toggleAutoAccept} />
        </div>
        <div className="r-avatars">
          {members.slice(0, 4).map((m) => (<span key={m.id} className="r-av" style={{ background: m.color }}>{initials(m.name)}<span className="pulse" /></span>))}
          <span className="r-av agent" style={{ background: "#d97757" }}>◆</span>
        </div>
        <button className="r-iconbtn" title="Take the guided tour" aria-label="Take the guided tour" data-testid="tour-button" onClick={startTour}><HelpCircle size={16} /></button>
        <ThemeToggle />
        <button className="r-iconbtn" title="Leave room" onClick={onLeave}><LogOut size={16} /></button>
      </div>

      <div className="r-workspace">
        {show.left && <LeftRail roomId={roomId} me={me} artId={curArt?.id ?? artId} style={{ width: layout.left }} onPick={openArtifact} />}
        {show.left && <ResizeHandle label="Resize files panel" onPointerDown={(x) => startResize("left", x)} />}
        <Chat roomId={roomId} me={me} channel="public" variant="public" agentName="Room NodeAgent" style={{ flex: layout.center }} onOpenArtifact={openArtifact} />
        {show.artifact && <ResizeHandle label="Resize spreadsheet panel" onPointerDown={(x) => startResize("middle", x)} />}
        {show.artifact && <Artifact roomId={roomId} me={me} artId={curArt?.id ?? artId} onArt={setArtId} style={{ flex: layout.artifact }} collab={store.canRunCollab ? { ...collab, onRun: runCollab } : undefined} />}
        {show.priv && <ResizeHandle label="Resize private agent panel" onPointerDown={(x) => startResize("right", x)} />}
        {show.priv && <Chat roomId={roomId} me={me} channel={privChannel} variant="private" agentName="Your NodeAgent" style={{ width: layout.right }} onOpenArtifact={openArtifact} />}
      </div>
      {autoAcceptModal && (
        <div className="r-modal-backdrop" role="presentation">
          <div className="r-modal" role="dialog" aria-modal="true" aria-labelledby="auto-accept-title">
            <button className="r-iconbtn r-modal-x" aria-label="Close" onClick={() => setAutoAcceptModal(false)}><X size={15} /></button>
            <div className="r-modal-icon"><ShieldCheck size={20} /></div>
            <h2 id="auto-accept-title">Turn on auto-accept?</h2>
            <p>Agent edits will apply directly after the tool layer validates locks, versions, permissions, and schema. You can turn this off any time to route agent edits into host-reviewed proposals.</p>
            <label className="r-checkline">
              <input type="checkbox" checked={rememberAutoAccept} onChange={(e) => setRememberAutoAccept(e.currentTarget.checked)} />
              Remember my preference on this device
            </label>
            <div className="r-modal-actions">
              <button className="r-btn ghost" onClick={() => setAutoAcceptModal(false)}>Keep review on</button>
              <button className="r-btn primary" onClick={confirmAutoAccept}><ShieldCheck size={14} /> Turn on auto-accept</button>
            </div>
          </div>
        </div>
      )}
      <GuidedTour steps={tourSteps} open={tourOpen} onClose={() => setTourOpen(false)} storageKey={TOUR_KEY} />
    </div>
  );
}

function ResizeHandle({ label, onPointerDown }: { label: string; onPointerDown: (clientX: number) => void }) {
  return (
    <button
      className="r-resize"
      aria-label={label}
      title={label}
      onPointerDown={(e) => { e.preventDefault(); onPointerDown(e.clientX); }}
    />
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => (document.documentElement.dataset.theme ?? "dark") === "dark");
  return (
    <button className="r-iconbtn" title="Toggle light / dark" onClick={() => { const n = dark ? "light" : "dark"; document.documentElement.dataset.theme = n; setDark(!dark); }}>
      {dark ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}
