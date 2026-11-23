import { forwardRef, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useActions, useData, useStillPC } from "../../state";

const MAX = 220;

/** The message box. Enter sends, Shift and Enter starts a new line. */
export const Composer = forwardRef<HTMLTextAreaElement, { big?: boolean }>(function Composer({ big }, outer) {
  const { ask } = useActions();
  const pc = useStillPC();
  const data = useData("answering");
  const [q, setQ] = useState("");
  const own = useRef<HTMLTextAreaElement | null>(null);
  const answering = data.answering;

  useLayoutEffect(() => {
    const t = own.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, MAX)}px`;
    t.style.overflowY = t.scrollHeight > MAX ? "auto" : "hidden";
  }, [q, answering]);

  const send = () => {
    if (answering || !q.trim()) return;
    ask(q);
    setQ("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
  };

  return (
    <form className={`chat-composer${big ? " big" : ""}`} onSubmit={(e) => { e.preventDefault(); send(); }}>
      <textarea
        id="ask-chat"
        ref={(el) => { own.current = el; if (typeof outer === "function") outer(el); else if (outer) outer.current = el; }}
        rows={1}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKey}
        placeholder={answering ? "Rig is answering. You can type your next question." : `Ask about ${pc.name}`}
        aria-label="Message"
      />
      <button className="chat-send" type="submit" disabled={answering || !q.trim()} aria-label={answering ? "Rig is answering" : "Send"}>
        {answering
          ? <span className="chat-spin" aria-hidden="true" />
          : <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16V4M5 9l5-5 5 5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </button>
    </form>
  );
});
