import { useEffect, useMemo, useState } from "react";
import { caughtProblem, isActive, limitsOf, logTitle, recorded, summarise, type HistoryPoint, type PCEvent, type Recording, type RecordingInfo, type RecordingSummary } from "@rig/core";
import { LineChart } from "../../chart";
import { Icon } from "../../components/common";
import { useActions, useData, useHistory, useStillPC, useTemp, useTempText } from "../../state";
import { CaughtChart, CaughtChecks, CaughtLead, CaughtTodo } from "./Caught";
import { CustomLogDetail } from "./CustomLog";
import { Rows } from "../../components/Rows";
import { EventRow } from "./Events";
import { Progress, StateChip } from "./RecordingCard";
import { AllSensors } from "./Lanes";
import { clock, clockSec, dayName, gb, isPhone } from "./words";

/** A recording or a log from Logs. Custom logs have a page of their own, since what they write can be anything. */
export function Detail({ info, onBack }: { info: RecordingInfo; onBack: () => void }) {
  return info.custom ? <CustomLogDetail info={info} onBack={onBack} /> : <RecordingDetail info={info} onBack={onBack} />;
}

/**
 * One recording: what Rig found, the readings with those moments marked, the busiest apps and the Windows events inside it.
 * A recording that caught a driver reset, a crash, a switch-off or a hardware error leads with that and its most likely cause.
 */
function RecordingDetail({ info, onBack }: { info: RecordingInfo; onBack: () => void }) {
  const { client, ask, stopRecording } = useActions();
  const pc = useStillPC();
  const data = useData("answering");
  const temp = useTemp();
  const inUnit = useTempText();
  const [rec, setRec] = useState<Recording | null | undefined>(undefined);
  // Fetch again as it grows and when it finishes.
  const version = `${info.id}|${info.state}|${Math.floor(info.sampleCount / 6)}`;
  useEffect(() => {
    let live = true;
    // A failed refetch keeps what's already on screen; the error shows only if nothing loaded yet.
    client.recording(pc.id, info.id).then((r) => live && setRec(r)).catch(() => live && setRec((r) => r ?? null));
    return () => { live = false; };
  }, [client, pc.id, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const limits = limitsOf(pc);
  const sum = useMemo(() => (rec ? summarise(rec, limits) : null), [rec, limits.cpu, limits.gpu]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = isActive(info);
  // The game's usual temperatures and the times Windows logged the same thing before, for a recording that caught a problem.
  const history = useHistory("30d");
  const [events, setEvents] = useState<PCEvent[] | null>(null);
  useEffect(() => {
    let live = true;
    client.events(pc.id).then((e) => live && setEvents(e)).catch(() => live && setEvents([]));
    return () => { live = false; };
  }, [client, pc.id]);
  const caught = useMemo(() => (rec && sum && !active && !info.background ? caughtProblem(rec, sum, { limits, history: history ?? undefined, events: events ?? undefined }) : null),
    [rec, sum, active, info.background, history, events, limits.cpu, limits.gpu]); // eslint-disable-line react-hooks/exhaustive-deps
  const temps: HistoryPoint[] = (rec?.samples ?? []).map((s) => ({ t: s.t, cpu: s.cpu ?? null, gpu: s.gpu ?? null, busy: false }));
  const loads: HistoryPoint[] = (rec?.samples ?? []).map((s) => ({ t: s.t, cpu: s.cpuLoad ?? null, gpu: s.gpuLoad ?? null, busy: false }));
  const marks = (sum?.moments ?? []).map((m, i) => ({ t: m.t, until: m.until, n: i + 1, strong: m.severity === "bad" }));
  const hasGpu = temps.some((p) => p.gpu != null);
  const series = hasGpu ? [{ key: "cpu" as const, cls: "cpu" }, { key: "gpu" as const, cls: "gpu" }] : [{ key: "cpu" as const, cls: "gpu" }];
  const mainLimit = hasGpu ? limits.gpu : limits.cpu;
  const question = `Look at the recording "${info.reason}" on ${pc.name}. What did it find, and what should I do?`;
  const stat = (k: "cpu" | "gpu") => sum?.stats[k];
  const top = sum?.offenders[0];
  const [stopping, setStopping] = useState(false);
  const stop = () => { setStopping(true); void stopRecording(info.id).finally(() => setStopping(false)); };
  const all = useMemo(() => (rec?.sensors?.length ? recorded(rec) : null), [rec]);
  const start = info.startedAt, end = info.finishedAt ?? info.endsAt ?? info.startedAt;
  const kind = info.id.startsWith("bg-a-") ? "Closer look" : info.background ? "Background log" : info.by === "rig" ? "Recording Rig started" : "Recording you started";
  const title = caught ? caught.title : info.state === "done" || info.state === "cancelled" ? logTitle(info) : info.reason;
  const meta = (caught ? [sum?.games[0] ?? null, start != null ? `${dayName(start)}, ${clock(start)} to ${clock(end!)}` : null, kind] : [start != null ? `${dayName(start)}, ${clock(start)} to ${clock(end!)}` : null, sum?.games[0] ?? null, kind]).filter(Boolean).join(" · ");
  const figs: { label: string; v: string; note?: string; look?: boolean; text?: boolean }[] = [];
  if (sum) {
    for (const k of ["gpu", "cpu"] as const) {
      const st = stat(k);
      if (!st) continue;
      const limit = limits[k];
      figs.push({ label: k === "gpu" ? "Graphics card" : "Processor", v: temp(st.max), note: limit != null ? `limit ${temp(limit)}` : `at ${clock(st.maxAt)}`, look: limit != null && st.max >= limit - 6 });
    }
    if (top) figs.push({ label: "Busiest app", v: top.name.replace(/\.exe$/i, ""), text: true, note: `${top.cpuAvg}% CPU · ${gb(top.memMaxMb)}` });
    figs.push({ label: "Windows events", v: String(rec?.events.length ?? 0) });
  }

  return (
    <div className="page rc-log">
      <div className="page-head">
        <div>
          <button type="button" className="btn ghost sm gm-back" onClick={onBack}><Icon d="M12 4 6 10l6 6" />Logs</button>
          <h1>{inUnit(title)}</h1>
          <p className="rc-when">{meta}</p>
          {info.question && <p className="faint rc-asked">You asked: "{info.question}"</p>}
        </div>
        <div className="gm-actions">
          <StateChip state={info.state} />
          {active && <button type="button" className="btn" disabled={stopping} onClick={stop}>{stopping ? "Stopping…" : "Stop recording"}</button>}
          {/* Rig's chat reads recordings on its server, and background logs stay on this PC. */}
          {!info.background && !active && <button type="button" className="btn primary sm" disabled={data.answering || info.state === "pending"} onClick={() => ask(question)}>Ask about this</button>}
        </div>
      </div>

      {info.state === "recording" && <section className="card card-pad"><Progress r={info} /></section>}
      {info.state === "pending" && <section className="card card-pad"><p className="muted">Waiting for the Rig app on {pc.name} to pick this up. It starts within about five minutes while the PC is on and signed in.</p></section>}
      {info.error && <div className="callout warn">{info.error}</div>}

      {rec === undefined || (caught && history === null) ? <p className="muted">Loading the recording…</p> : !rec || !sum ? <p className="muted">Rig couldn't load this recording. Go back to Logs and open it again.</p> : caught ? (
        <>
          <CaughtLead caught={caught} />
          <CaughtChart samples={rec.samples} caught={caught} limit={limits[caught.part]} minutes={sum.minutes} />
          <div className="cg-lower">
            <CaughtChecks caught={caught} />
            <CaughtTodo caught={caught} info={info} />
          </div>
          <MoreAbout rec={rec} sum={sum} active={active} />
        </>
      ) : (
        <>
          {sum.samples > 0 && (
            <dl className="rc-figs" aria-label="Key readings">
              {figs.map((f) => <div key={f.label}><dt>{f.label}</dt><dd className={`num rc-fig${f.look ? " look" : ""}${f.text ? " text" : ""}`}>{f.v}</dd>{f.note && <dd className="faint">{f.note}</dd>}</div>)}
            </dl>
          )}

          <section className="rc-found" aria-labelledby="rc-found-h">
            <h2 id="rc-found-h" className="lg-h">What Rig found</h2>
            {sum.moments.length === 0 ? <p className="muted">{active ? "Anything unusual shows here as it happens." : "Every reading stayed in its usual range."}</p> : (
              <ol className="rec-moments">
                {sum.moments.map((m, i) => (
                  <li key={`${m.t}${m.title}`} className={m.severity}>
                    <span className="rec-n num">{i + 1}</span>
                    <span className="num faint">{clockSec(m.t)}</span>
                    <span className="ev-text"><b>{inUnit(m.title)}</b></span>
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
                </div>
              </div>
              <LineChart points={temps} series={series} limit={mainLimit != null ? { v: mainLimit, label: `${temp(mainLimit)} limit` } : undefined} h={240} marks={marks} label="Temperatures during the recording" />
              {!all && loads.some((p) => p.cpu != null || p.gpu != null) && (
                <>
                  <h2>How hard each part worked</h2>
                  <LineChart points={loads} series={series} h={180} unit="percent" marks={marks} label="Usage during the recording" />
                </>
              )}
            </section>
          )}

          {all && start != null && (
            <section className="rc-readings" aria-labelledby="rc-all-h">
              <div className="rc-sech">
                <h2 id="rc-all-h" className="lg-h">All sensors</h2>
                <span className="faint">{all.sensors.length} sensors · every {Math.round(rec.intervalMs / 1000)} s</span>
              </div>
              <AllSensors r={all} from={all.points[0]?.t ?? start} to={all.points.at(-1)?.t ?? end!} limits={limits}
                marks={sum.moments.map((m, i) => ({ t: m.t, look: m.severity === "bad", n: i + 1 }))} compact={isPhone()} />
            </section>
          )}

          <MoreAbout rec={rec} sum={sum} active={active} />
        </>
      )}
    </div>
  );
}

/** The busiest apps and what Windows logged, behind a toggle at the foot of a recording's page. */
function MoreAbout({ rec, sum, active }: { rec: Recording; sum: RecordingSummary; active: boolean }) {
  const [more, setMore] = useState(false);
  return (
    <section className="lg-all" aria-labelledby="rec-more-h">
      <h2 id="rec-more-h" className="lg-h">
        <button type="button" className="lg-all-toggle" aria-expanded={more} aria-controls="rec-more-body" onClick={() => setMore(!more)}>
          <Icon d="M8 4l6 6-6 6" />Apps and Windows events
        </button>
      </h2>
      <div id="rec-more-body">
        {more ? (
          <div className="card card-pad rec-more">
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
                : <Rows timeline>{rec.events.map((e) => <EventRow key={`${e.t}${e.source}${e.id}`} e={e} seconds />)}</Rows>}
            </section>
          </div>
        ) : <p className="faint">The busiest apps, and what Windows logged.</p>}
      </div>
    </section>
  );
}
