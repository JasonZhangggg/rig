// A laptop's battery on its part page: the charge and how long it lasts as
// big figures, then a tab with today's story on battery and the few changes
// that would stretch it, each through the usual review. Desktops have none.

import { useState } from "react";
import { fixSteps, type BatterySaver, type BatteryView } from "@rig/core";
import { Row, Rows } from "../../components/Rows";
import { useActions } from "../../state";

/** The battery's figures for the top of its page: the charge, and the time left or until full. */
export function batteryTiles(b: BatteryView): JSX.Element[] {
  const tiles: JSX.Element[] = [];
  if (b.level != null) {
    const how = b.state === "discharging" && b.watts != null ? `Drawing ${b.watts} W`
      : b.state === "charging" && b.watts != null ? `Charging at ${Math.round(b.watts)} W`
      : b.state === "plugged" ? b.time?.text : undefined;
    tiles.push(
      <div key="charge" className="live">
        <span className="label">Charge</span>
        <span key={b.level} className="big live-tick">{b.level}%</span>
        <span className="bar live-load" aria-hidden="true"><i style={{ transform: `translateX(${b.level - 100}%)` }} /></span>
        {how && <span className="faint batt-how">{how}</span>}
      </div>,
    );
  }
  if (b.time?.figure) {
    tiles.push(
      <div key="time" className="live">
        <span className="label">{b.time.label}</span>
        <span className="big">{b.time.figure}</span>
        {b.time.basis && <span className="faint batt-how">{b.time.basis}</span>}
      </div>,
    );
  }
  return tiles;
}

/** The Battery life tab: what drained it today, and ways to make it last longer. */
export function BatteryLife({ battery }: { battery: BatteryView }) {
  const story = [battery.story, battery.time?.note && `${battery.time.note}.`].filter(Boolean).join(" ");
  return (
    <div className="batt">
      {story && <p className="batt-story">{story}</p>}
      <section className="batt-savers" aria-labelledby="batt-savers-h">
        <h3 id="batt-savers-h" className="label">Make it last longer</h3>
        {battery.savers.length ? (
          <Rows label="Ways to make the battery last longer">
            {battery.savers.map((s) => <Saver key={s.id} saver={s} />)}
          </Rows>
        ) : <p className="muted batt-none">Nothing to change. The settings Rig can change already go easy on the battery.</p>}
        {battery.savers.length > 0 && <p className="faint batt-foot">Each one can be undone from Changes.</p>}
      </section>
    </div>
  );
}

function Saver({ saver }: { saver: BatterySaver }) {
  const { review } = useActions();
  const [reading, setReading] = useState(false);
  const open = () => { setReading(true); void review(fixSteps(saver.fix), { by: "you", why: saver.title }).finally(() => setReading(false)); };
  return (
    <Row name={saver.title} title={saver.title} meta={saver.meta}
      action={<button className="btn ghost sm" type="button" aria-label={`Review: ${saver.title}`} disabled={reading} onClick={open}>{reading ? "Reading settings…" : "Review"}</button>} />
  );
}
