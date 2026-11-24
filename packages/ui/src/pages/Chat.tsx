import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage, Proposal } from "@rig/core";
import { DiffTable } from "../components/common";
import { useActions, useData, useStillPC, useTempText } from "../state";
import { RecordingCard } from "./logs/RecordingCard";
import { ChatBar } from "./chat/ChatBar";
import { ProbeNote, ScriptCard } from "./chat/ScriptCard";
import { Composer } from "./chat/Composer";
import { FollowUps, notAsked, StarterGrid, useStarters } from "./chat/starters";
import { Sources } from "./chat/Sources";

export function Chat() {
  const { client, clearChat } = useActions();
  const pc = useStillPC();
  const data = useData("answering", "chat");
  const starters = useStarters();
  const box = useRef<HTMLTextAreaElement>(null);
  const empty = data.chat.length === 0;
  useStickToBottom(data.chat, data.answering);
  const next = data.answering ? [] : notAsked(starters, data.chat);
  const startOver = () => { clearChat(); box.current?.focus(); };
  return (
    <div className={`page chat-page${empty ? " is-empty" : ""}`}>
      <ChatBar onNew={startOver} />
      <div className="chat-main">
        {empty ? (
          <div className="chat-hello">
            <h1>What's going on with {pc.name}?</h1>
            <p>Ask in your own words. Rig reads {pc.name}'s temperatures, settings and parts, and checks your parts' manuals.</p>
          </div>
        ) : (
          <>
            <h1 className="sr-only">Ask Rig about {pc.name}</h1>
            <div className="thread" aria-live="polite">
              {data.chat.map((m) => <Message key={m.id} m={m} />)}
            </div>
          </>
        )}
        <div className="chat-dock">
          {!empty && <FollowUps starters={next} />}
          <Composer ref={box} big={empty} />
          <p className="chat-rules">
            Rig shows every change first and waits for your yes. Undo anything in <a href="#changes">Changes</a>, and stop a recording in <a href="#logs">Logs</a>.
            {!client.caps.applyChanges && <> Fixes are made from the Rig app on {pc.name}.</>}
          </p>
        </div>
        {empty && <StarterGrid starters={starters} />}
      </div>
    </div>
  );
}

/** Keeps the newest message in view while Rig answers, unless the person has scrolled up to read. */
function useStickToBottom(chat: ChatMessage[], answering: boolean) {
  const stick = useRef(true);
  const seen = useRef(0);
  useEffect(() => {
    const page = () => document.scrollingElement ?? document.documentElement;
    const on = () => { const el = page(); stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140; };
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const last = chat[chat.length - 1];
  useLayoutEffect(() => {
    if (chat.length > seen.current) stick.current = true;
    seen.current = chat.length;
    if (!stick.current || !chat.length) return;
    const el = document.scrollingElement ?? document.documentElement;
    el.scrollTop = el.scrollHeight;
  }, [chat.length, last?.text, last?.steps, last?.sources, last?.proposal, last?.script, answering]);
}

function Message({ m }: { m: ChatMessage }) {
  const inUnit = useTempText();
  if (m.from === "you") return <div className="msg you"><div className="bubble">{m.text}</div></div>;
  const paras = inUnit(m.text).split(/\n{2,}/).filter(Boolean);
  return (
    <div className={`msg claude${m.error ? " error" : ""}`}>
      <span className="who-mark" aria-label="Rig">R</span>
      <div className="body">
        {paras.length ? paras.map((p, i) => <p key={i}>{p}</p>) : m.pending ? <p className="typing" aria-label="Rig is thinking"><i /><i /><i /></p> : null}
        {m.steps && <ol className="steps">{m.steps.map((s) => <li key={s}>{inUnit(s)}</li>)}</ol>}
        {m.sources && <Sources sources={m.sources} />}
        {m.proposal && <ProposalCard p={m.proposal} />}
        {m.recording && <RecordingCard request={m.recording} />}
        {m.probe && <ProbeNote m={m} />}
        {m.script && <ScriptCard m={m} />}
      </div>
    </div>
  );
}

function ProposalCard({ p }: { p: Proposal }) {
  const { review, declineProposal } = useActions();
  const [reading, setReading] = useState(false);
  const n = p.calls.length;
  return (
    <div className="proposal">
      <div className="proposal-head">
        <h3>{p.title}</h3>
        {p.status === "applied" ? <span className="chip ok">Applied</span> : p.status === "declined" ? <span className="chip">Not now</span> : <span className="chip info">Waiting for you</span>}
      </div>
      <DiffTable rows={p.rows} />
      <div className="proposal-foot">
        <span className="faint">{n === 1 ? "1 change" : `${n} changes`} · undo anytime</span>
        {p.status === "applied" ? <a className="btn ghost sm" href="#changes">View in Changes</a> : p.status === "declined" ? null : (
          <>
            <button className="btn ghost sm" type="button" disabled={reading} onClick={() => declineProposal(p.id)}>Not now</button>
            <button className="btn primary sm" type="button" disabled={reading} onClick={() => { setReading(true); void review(p.calls, { title: p.title, by: "rig", why: p.why, proposalId: p.id }).finally(() => setReading(false)); }}>{reading ? "Reading settings…" : "Review and apply"}</button>
          </>
        )}
      </div>
    </div>
  );
}
