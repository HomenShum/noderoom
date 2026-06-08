/** Landing (`.r-landing`) — design hero + create/join, recreated from room.css. */
import { useState } from "react";
import { Sparkles, Table2, Lock, History } from "lucide-react";
import { engine, demo, createFreshRoom, joinRoomByCode } from "../app/roomStore";
import type { Session } from "./App";

export function Landing({ onEnter }: { onEnter: (s: Session) => void }) {
  const code = engine.getRoom(demo.roomId)?.code ?? "";
  const [join, setJoin] = useState(code);
  const [name, setName] = useState("");

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
          <div className="r-cta-row">
            <button className="r-btn primary" onClick={() => onEnter({ roomId: demo.roomId, me: demo.me })}>
              Enter the Q3 diligence room →
            </button>
            <div className="r-join-inline">
              <input placeholder="CODE" value={join} onChange={(e) => setJoin(e.target.value)} aria-label="Room code" />
              <button className="r-send" style={{ width: "auto", padding: "0 12px", borderRadius: 8 }}
                onClick={() => { const s = joinRoomByCode(join, name || "Guest"); if (s) onEnter(s); else alert("Room not found for that code."); }}>
                Join
              </button>
            </div>
            <button className="r-btn ghost" onClick={() => onEnter(createFreshRoom("My room", name || "Host"))}>Create a room</button>
          </div>
          <input className="r-text-input" placeholder="Your display name (for join / create)" value={name} onChange={(e) => setName(e.target.value)}
            style={{ marginTop: 18, maxWidth: 320, padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line-strong)", background: "var(--bg-secondary)", color: "var(--text-primary)" }} />

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
