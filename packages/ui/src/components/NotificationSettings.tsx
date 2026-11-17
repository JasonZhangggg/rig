import { alertRules } from "@rig/core";
import { setAlertKind, useAlertKindsOff } from "../state";

/**
 * Which alerts Rig raises on this device. It keeps its own preferences, so it
 * can sit on any page. Pass desktop in the Rig app for Windows, where alerts
 * also arrive as Windows notifications.
 */
export function NotificationSettings({ desktop = false }: { desktop?: boolean }) {
  const off = useAlertKindsOff();
  return (
    <section className="card" aria-labelledby="notify-settings-h">
      <div className="card-head"><h2 id="notify-settings-h">Alerts</h2></div>
      <p className="muted notify-note">
        {desktop
          ? "Rig puts these at the top of Things to look at, and sends a Windows notification when one starts while Rig's window isn't in front."
          : "Rig puts these at the top of Things to look at. The Rig app on each PC can also send a Windows notification."}
      </p>
      <div className="switch-list">
        {alertRules.map((r) => {
          const on = !off.includes(r.kind);
          return (
            <button key={r.kind} type="button" className="switch" role="switch" aria-checked={on} onClick={() => setAlertKind(r.kind, !on)}>
              <span><b>{r.label}</b><small>{r.description}</small></span><i />
            </button>
          );
        })}
      </div>
    </section>
  );
}
