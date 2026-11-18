import { useEffect, useMemo, useState } from "react";
import { isActive, limitsOf, summarise, type HistoryPoint, type Recording, type RecordingInfo } from "@rig/core";
import { LineChart } from "../../chart";
import { Icon } from "../../components/common";
import { useApp, useTemp, useTempText } from "../../state";
import { EventRow } from "./Events";
import { Progress, StateChip } from "./RecordingCard";
import { clock, clockSec, gb, whenRan } from "./words";

/** One recording: what Rig found, the readings with those moments marked, the busiest apps and the Windows events inside it. */
export function Detail({ info, onBack }: { info: RecordingInfo; onBack: () => void }) {
  const { client, pc, ask, stopRecording, data } = useApp();
  const temp = useTemp();
  const inUnit = useTempText();
  const [rec, setRec] = useState<Recording | null | undefined>(undefined);
  // Fetch again as it grows and when it finishes.
  const version = `${info.id}|${info.state}|${Math.floor(info.sampleCount / 6)}`;
  useEffect(() => {
    let live = true;
    client.recording(pc.id, info.id).then((r) => live && setRec(r)).catch(() => live && setRec(null));
    return () => { live = false; };
  }, [client, pc.id, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const limits = limitsOf(pc);
  const sum = useMemo(() => (rec ? summarise(rec, limits) : null), [rec, limits.cpu, limits.gpu]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = isActive(info);
  const temps: HistoryPoint[] = (rec?.samples ?? []).map((s) => ({ t: s.t, cpu: s.cpu ?? null, gpu: s.gpu ?? null, busy: false }));
  const loads: HistoryPoint[] = (rec?.samples ?? []).map((s) => ({ t: s.t, cpu: s.cpuLoad ?? null, gpu: s.gpuLoad ?? null, busy: false }));
  const marks = (sum?.moments ?? []).map((m, i) => ({ t: m.t, until: m.until, n: i + 1, strong: m.severity === "bad" }));
  const hasGpu = temps.some((p) => p.gpu != null);
  const series = hasGpu ? [{ key: "cpu" as const, cls: "cpu" }, { key: "gpu" as const, cls: "gpu" }] : [{ key: "cpu" as const, cls: "gpu" }];
  const mainLimit = hasGpu ? limits.gpu : limits.cpu;
  const question = `Look at the recording "${info.reason}" on ${pc.name}. What did it find, and what should I do?`;
  const stat = (k: "cpu" | "gpu") => sum?.stats[k];
  const top = sum?.offenders[0];
  const [more, setMore] = useState(false);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <button type="button" className="btn ghost sm gm-back" onClick={onBack}><Icon d="M12 4 6 10l6 6" />All logs</button>
          <h1>{info.minutes}-minute recording</h1>
          <p className="sub">{info.reason}</p>
          <p className="rec-meta-line">{whenRan(info)}. Started by {info.by === "rig" ? "Rig" : "you"}{info.question ? ` after you asked "${info.question}"` : ""}</p>
        </div>
        <div className="gm-actions">
          <StateChip state={info.state} />
          {active && <button type="button" className="btn" onClick={() => stopRecording(info.id)}>Stop recording</button>}
        </div>
      </div>

      {info.state === "recording" && <section className="card card-pad"><Progress r={info} /></section>}
      {info.state === "pending" && <section className="card card-pad"><p className="muted">Waiting for the Rig app on {pc.name} to pick this up. It starts within about five minutes while the PC is on and signed in.</p></section>}
      {info.error && <div className="callout warn">{info.error}</div>}

      {rec === undefined ? <p className="muted">Loading the recording…</p> : !rec || !sum ? <p className="muted">Rig couldn't load this recording.</p> : (
        <>
          <section className="lg-lede" aria-label="What it found">
            <p className="lg-lede-text">{active && sum.moments.length === 0 ? "Nothing unusual so far." : inUnit(sum.headline)}</p>
            <button type="button" className="btn primary sm" disabled={data.answering || info.state === "pending"} onClick={() => ask(question)}>Ask about this</button>
          </section>

          <section className="card card-pad rec-found-card">
            <h2>What Rig found</h2>
            {sum.moments.length === 0 ? <p className="muted">{active ? "Rig adds anything unusual here as it happens." : "Every reading stayed in its usual range."}</p> : (
              <ol className="rec-moments">
                {sum.moments.map((m, i) => (
                  <li key={`${m.t}${m.title}`} className={m.severity}>
                    <span className="rec-n num">{i + 1}</span>
                    <span className="num faint">{clockSec(m.t)}</span>
                    <span className="ev-text"><b>{inUnit(m.title)}</b><span className="muted">{inUnit(m.detail)}</span></span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {temps.length > 1 && (
            <section className="card card-pad rec-chart">
              <div className="gm-sess-head">
                <h2>Temperatures</h2>
                <div className="legend">
                  {hasGpu && <span><i className="lg-cpu" />Processor</span>}
                  <span><i className="lg-gpu" />{hasGpu ? "Graphics card" : "Processor"}</span>
                  {mainLimit != null && <span><i className="lg-limit" />Safe limit</span>}
                  {marks.length > 0 && <span><i className="lg-mark" />Numbers match the list above</span>}
                </div>
              </div>
              <LineChart points={temps} series={series} limit={mainLimit != null ? { v: mainLimit, label: `${temp(mainLimit)} limit` } : undefined} h={240} marks={marks} label="Temperatures during the recording" />
              {loads.some((p) => p.cpu != null || p.gpu != null) && (
                <>
                  <h2>How hard each part worked</h2>
                  <LineChart points={loads} series={series} h={180} percent marks={marks} label="Load during the recording" />
                </>
              )}
            </section>
          )}

          <section className="lg-all" aria-labelledby="rec-more-h">
            <h2 id="rec-more-h" className="lg-h">
              <button type="button" className="lg-all-toggle" aria-expanded={more} aria-controls="rec-more-body" onClick={() => setMore(!more)}>
                <Icon d="M8 4l6 6-6 6" />Readings, apps and Windows events
              </button>
            </h2>
            <div id="rec-more-body">
              {more ? (
                <div className="card card-pad rec-more">
                  {sum.samples > 0 && (
                    <div className="rec-figs">
                      {(["gpu", "cpu"] as const).filter((k) => stat(k)).map((k) => {
                        const s = stat(k)!, limit = limits[k], near = limit != null && s.max >= limit - 6;
                        return (
                          <div key={k}>
                            <div className="label">{k === "gpu" ? "Graphics card" : "Processor"} at its hottest</div>
                            <p className="num rec-fig" style={near ? { color: "var(--warn)" } : undefined}>{temp(s.max)}</p>
                            <p className="muted">At {clock(s.maxAt)}, {temp(s.avg)} on average.{limit != null ? ` Its safe limit is ${temp(limit)}.` : ""}</p>
                          </div>
                        );
                      })}
                      <div>
                        <div className="label">Busiest app</div>
                        <p className="rec-fig rec-app">{top ? top.name : "None"}</p>
                        <p className="muted">{top ? `About ${top.cpuAvg}% of the processor, up to ${gb(top.memMaxMb)} of memory.` : "Rig didn't record apps this time."}{sum.games.length ? ` In front: ${sum.games.join(", ")}.` : ""}</p>
                      </div>
                    </div>
                  )}

                  {sum.offenders.length > 0 && (
                    <section className="rec-apps">
                      <h2>Busiest apps</h2>
                      <table className="kv rec-table">
                        <thead><tr><th>App</th><th>Processor, typical</th><th>Processor, highest</th><th>Memory, most</th>{sum.offenders.some((o) => o.gpuMax != null) && <th>Graphics card, highest</th>}</tr></thead>
                        <tbody>
                          {sum.offenders.map((o) => (
                            <tr key={o.name}><td>{o.name}</td><td className="num">{o.cpuAvg}%</td><td className="num">{o.cpuMax}%</td><td className="num">{gb(o.memMaxMb)}</td>{sum.offenders.some((x) => x.gpuMax != null) && <td className="num">{o.gpuMax != null ? `${o.gpuMax}%` : "–"}</td>}</tr>
                          ))}
                        </tbody>
                      </table>
                    </section>
                  )}

                  <section className="rec-events">
                    <h2>Windows events during the recording</h2>
                    {rec.events.length === 0 ? <p className="muted">{active ? "Rig reads the event log when the recording ends." : "Windows logged no errors while Rig recorded."}</p>
                      : <div><ul className="ev-list">{rec.events.map((e) => <EventRow key={`${e.t}${e.source}${e.id}`} e={e} seconds />)}</ul></div>}
                  </section>
                </div>
              ) : <p className="faint">The hottest readings, the busiest apps and what Windows logged while Rig recorded.</p>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
