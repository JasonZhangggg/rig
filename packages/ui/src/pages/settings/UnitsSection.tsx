import { tempUnits, type TempUnit } from "@rig/core";
import { useApp, useTemp } from "../../state";
import { SettingRow } from "./parts";

const names: Record<TempUnit, string> = { c: "°C", f: "°F" };

export function UnitsSection() {
  const { ui, pc, set } = useApp();
  const temp = useTemp();
  const part = pc.parts?.gpu?.temp != null ? pc.parts.gpu : pc.parts?.cpu;
  return (
    <SettingRow id="units-temp" title="Temperatures"
      body={part?.temp != null
        ? `${pc.name}'s ${part.type.toLowerCase()} is at ${temp(part.temp)} right now. Saved on this device.`
        : "Rig measures in °C and shows the unit you pick. Saved on this device."}>
      <div className="seg" role="group" aria-labelledby="units-temp">
        {tempUnits.map((u) => <button key={u} type="button" aria-pressed={ui.tempUnit === u} onClick={() => set({ tempUnit: u })}>{names[u]}</button>)}
      </div>
    </SettingRow>
  );
}
