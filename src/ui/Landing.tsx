/** Landing (`.r-landing`) — design hero + create/join, recreated from room.css. */
import { useState } from "react";
import { Sparkles, Table2, Lock, History, PlayCircle } from "lucide-react";
import { engine, demo, createFreshRoom, joinRoomByCode } from "../app/roomStore";
import type { Session } from "./App";
import { LandingStory } from "../landing/LandingStory";

export function Landing({ onEnter }: { onEnter: (s: Session) => void }) {
  const code = engine.getRoom(demo.roomId)?.code ?? "";
  const [join, setJoin] = useState(code);
  const [name, setName] = useState("");
  const [joinErr, setJoinErr] = useState<string | null>(null);
  const [story, setStory] = useState(false);
  const tryJoin = () => { const s = joinRoomByCode(join, name || "Guest"); if (s) onEnter(s); else setJoinErr(`No room found for "${join.toUpperCase()}".`); };

  // The scroll-driven product story — a separate full-screen surface reachable
  // from the hero. Static (no live Convex); see src/landing/LandingStory.tsx.
  if (story) return <LandingStory onEnter={onEnter} onBack={() => setStory(false)} />;

  return (
    <div className="r-app">
      <div className="r-screen">
        <div className="r-landing">
          <span className="r-eyebrow"><Sparkles size={13} /> NodeRoom · live collaborative room</span>
          <h1 className="r-h1">A room where you and <span className="accent">NodeAgents</span> edit together.</h1>
          <p className="r-lede">
            Public chat, a private NodeAgent, and a shared spreadsheet / note / post-it wall — with a
            <b> lock → draft → smart-merge</b> model so a human and an agent never clobber each other.
          </p>
          {/* The marquee path: a scroll-driven 7-layer walkthrough of the product story. */}
          <button className="r-btn primary" style={{ marginBottom: 4 }} onClick={() => setStory(true)}>
            <PlayCircle size={15} /> See how it works — the 7-layer walkthrough
          </button>
          {/* Name field ABOVE the CTAs that consume it (form-layout: inputs precede their submit),
              with a real label + example-data placeholder (placeholder-is-not-a-label). */}
          <label className="r-field" style={{ maxWidth: 320 }}>
            <span className="r-field-label">Display name</span>
            <input className="r-text-input" placeholder="e.g. Priya" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="r-cta-row">
            <button className="r-btn primary" onClick={() => onEnter({ roomId: demo.roomId, me: demo.me })}>
              Enter the Q3 diligence room →
            </button>
            <div className="r-join-inline">
              <input placeholder="CODE" value={join} onChange={(e) => { setJoin(e.target.value); setJoinErr(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") tryJoin(); }} aria-label="Room code" />
              {/* One filled primary per view (the hero CTA above) — Join is the bordered
                  secondary so the input stays the focus of this group. */}
              <button className="r-btn" onClick={tryJoin}>Join</button>
            </div>
            <button className="r-btn ghost" onClick={() => onEnter(createFreshRoom("My room", name || "Host"))}>Create a room</button>
          </div>
          {joinErr && <div className="r-join-error" role="alert">{joinErr}</div>}

          <div className="r-feature-grid">
            <div className="r-feature"><div className="fi"><Table2 size={16} /></div><h3>Shared artifacts</h3><p>A spreadsheet, note, and post-it wall every member and agent edits live.</p></div>
            <div className="r-feature"><div className="fi"><Lock size={16} /></div><h3>Lock → draft → merge</h3><p>An agent claims a range, others draft around it, and it smart-merges on unlock — no clobbering.</p></div>
            <div className="r-feature"><div className="fi"><History size={16} /></div><h3>Per-room trace</h3><p>Every change, by hand or agent, is recorded as a versioned delta you can audit.</p></div>
          </div>
        </div>
      </div>
    </div>
  );
}
