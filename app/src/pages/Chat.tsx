import { useState } from "react";
import type { ChatMessage, Proposal } from "../data";
import { DiffTable } from "../components/common";
import { useApp } from "../state";

const followUps = ["How do I clean the filter?", "Will this void my warranty?", "Show me the fan curve"];

export function Chat() {
  const { ui, pc, ask } = useApp();
  const [q, setQ] = useState("");
  return (
    <div className="page">
      <div className="page-head"><div><h1>Ask</h1><p className="sub">Answers come from your parts' manuals, maker support pages and {pc.name}'s own readings. Every fix is shown to you first and can be undone.</p></div></div>
      <div className="chat-wrap">
        <section className="card">
          <div className="thread">{ui.chat.map((m, i) => <Message key={i} m={m} />)}</div>
          <div className="suggest">{followUps.map((s) => <button key={s} type="button" onClick={() => ask(s)}>{s}</button>)}</div>
          <form className="composer" onSubmit={(e) => { e.preventDefault(); ask(q); setQ(""); }}>
            <input id="ask-chat" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Ask about ${pc.name}`} aria-label="Message" />
            <button className="btn primary">Send</button>
          </form>
        </section>
        <aside className="card card-pad rules">
          <h2>How fixes work</h2>
          <ul>
            <li>Rig shows every change before it happens, with the value now and the value after.</li>
            <li>Nothing changes until you say yes.</li>
            <li>A restore point is made before each change.</li>
            <li>Everything is listed in Changes with one-tap undo.</li>
          </ul>
          <a className="btn" href="#changes">Open Changes</a>
        </aside>
      </div>
    </div>
  );
}

function Message({ m }: { m: ChatMessage }) {
  if (m.from === "you") return <div className="msg you"><div className="bubble">{m.text}</div></div>;
  return (
    <div className="msg claude">
      <span className="who-mark" aria-label="Rig">R</span>
      <div className="body">
        <p>{m.text}</p>
        {m.text2 && <p>{m.text2}</p>}
        {m.steps && <ol className="steps">{m.steps.map((s) => <li key={s}>{s}</li>)}</ol>}
        {m.sources && <div className="sources">{m.sources.map((s) => <span key={s.label} className="source"><b>{s.kind}</b>{s.label}</span>)}</div>}
        {m.proposal && <ProposalCard p={m.proposal} />}
      </div>
    </div>
  );
}

function ProposalCard({ p }: { p: Proposal }) {
  const { ui, set, toast } = useApp();
  const done = ui.proposalApplied;
  return (
    <div className="proposal">
      <div className="proposal-head"><h3>{p.title}</h3>{done ? <span className="chip ok">Applied</span> : <span className="chip info">Waiting for you</span>}</div>
      <DiffTable rows={p.changes} />
      <div className="proposal-foot">
        <span className="faint">{p.changes.length} changes · undo anytime</span>
        {done ? <a className="btn sm" href="#changes">View in Changes</a> : (
          <>
            <button className="btn sm" type="button" onClick={() => toast("Okay, nothing was changed.")}>Not now</button>
            <button className="btn primary sm" type="button" onClick={() => set({ modal: { kind: "proposal", title: `Apply ${p.changes.length} changes?`, body: p.title, rows: p.changes, cta: `Apply ${p.changes.length} changes` } })}>Review and apply</button>
          </>
        )}
      </div>
    </div>
  );
}
