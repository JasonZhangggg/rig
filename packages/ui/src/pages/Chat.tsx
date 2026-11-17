import { useState } from "react";
import type { ChatMessage, Proposal } from "@rig/core";
import { DiffTable } from "../components/common";
import { useApp, useTempText } from "../state";

export function Chat() {
  const { data, pc, ask, client } = useApp();
  const [q, setQ] = useState("");
  const inUnit = useTempText();
  const starters = [
    ...(pc.issues ?? []).filter((i) => i.ask).slice(0, 2).map((i) => inUnit(i.ask!)),
    `Why is ${pc.name} loud?`,
    "Why is startup slow?",
    "Can my screen look smoother?",
  ].slice(0, 4);
  return (
    <div className="page mid">
      <div className="page-head"><div><h1>Ask</h1><p className="sub">Answers come from your parts' manuals, maker support pages and {pc.name}'s own readings. Every fix is shown to you first and can be undone.</p></div></div>
      <div className="chat-wrap">
        <section className="card">
          <div className="thread" aria-live="polite">
            {data.chat.length === 0 && (
              <div className="msg claude">
                <span className="who-mark" aria-label="Rig">R</span>
                <div className="body"><p>Hi! I can see {pc.name}'s temperatures, settings and parts. Ask me what's wrong, how to fix something, or what to upgrade.</p></div>
              </div>
            )}
            {data.chat.map((m) => <Message key={m.id} m={m} />)}
          </div>
          {!data.answering && <div className="suggest">{starters.map((s) => <button key={s} type="button" onClick={() => ask(s)}>{s}</button>)}</div>}
          <form className="composer" onSubmit={(e) => { e.preventDefault(); if (!data.answering) { ask(q); setQ(""); } }}>
            <input id="ask-chat" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Ask about ${pc.name}`} aria-label="Message" />
            <button className="btn primary" disabled={data.answering || !q.trim()}>{data.answering ? "Answering…" : "Send"}</button>
          </form>
        </section>
        <aside className="card card-pad rules">
          <h2>How fixes work</h2>
          <ul>
            <li>Rig shows every change before it happens, with the value now and the value after.</li>
            <li>Nothing changes until you say yes.</li>
            <li>Rig saves the old values first.</li>
            <li>Everything is listed in Changes with one-tap undo.</li>
            {!client.caps.applyChanges && <li>Fixes are made from the Rig app on {pc.name}. Here you can ask and read.</li>}
          </ul>
          <a className="btn" href="#changes">Open Changes</a>
        </aside>
      </div>
    </div>
  );
}

function Message({ m }: { m: ChatMessage }) {
  if (m.from === "you") return <div className="msg you"><div className="bubble">{m.text}</div></div>;
  const paras = m.text.split(/\n{2,}/).filter(Boolean);
  return (
    <div className={`msg claude${m.error ? " error" : ""}`}>
      <span className="who-mark" aria-label="Rig">R</span>
      <div className="body">
        {paras.length ? paras.map((p, i) => <p key={i}>{p}</p>) : m.pending ? <p className="typing" aria-label="Rig is thinking"><i /><i /><i /></p> : null}
        {m.steps && <ol className="steps">{m.steps.map((s) => <li key={s}>{s}</li>)}</ol>}
        {m.sources && m.sources.length > 0 && (
          <div className="sources">{m.sources.map((s) => s.url
            ? <a key={s.label} className="source" href={s.url} target="_blank" rel="noreferrer"><b>{s.kind}</b>{s.label}</a>
            : <span key={s.label} className="source"><b>{s.kind}</b>{s.label}</span>)}</div>
        )}
        {m.proposal && <ProposalCard p={m.proposal} />}
      </div>
    </div>
  );
}

function ProposalCard({ p }: { p: Proposal }) {
  const { review, declineProposal } = useApp();
  const n = p.calls.length;
  return (
    <div className="proposal">
      <div className="proposal-head">
        <h3>{p.title}</h3>
        {p.status === "applied" ? <span className="chip ok">Done</span> : p.status === "declined" ? <span className="chip">Not now</span> : <span className="chip info">Waiting for you</span>}
      </div>
      <DiffTable rows={p.rows} />
      <div className="proposal-foot">
        <span className="faint">{n === 1 ? "1 change" : `${n} changes`} · undo anytime</span>
        {p.status === "applied" ? <a className="btn sm" href="#changes">View in Changes</a> : p.status === "declined" ? null : (
          <>
            <button className="btn sm" type="button" onClick={() => declineProposal(p.id)}>Not now</button>
            <button className="btn primary sm" type="button" onClick={() => review(p.calls, { title: p.title, by: "rig", why: p.why, proposalId: p.id })}>Review and apply</button>
          </>
        )}
      </div>
    </div>
  );
}
