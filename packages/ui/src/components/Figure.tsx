/** A figure in a row of them: the number, what it is, and a line of context. With onClick it's a button that shows its moment on the chart. */
export function Figure({ label, figure, note, warn, pressed, onClick }: { label: string; figure: string; note: string; warn?: boolean; pressed?: boolean; onClick?: () => void }) {
  const inner = (
    <>
      <span className="label">{label}</span>
      <span className={`num fig-n${warn ? " warn" : ""}`}>{figure}</span>
      <span className="muted">{note}</span>
    </>
  );
  return pressed == null || !onClick ? <div className="fig">{inner}</div>
    : <button type="button" className="fig" aria-pressed={pressed} onClick={onClick}>{inner}</button>;
}
