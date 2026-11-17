import { alertRules } from "@rig/core";
import { SettingRow } from "../pages/settings/parts";
import { setAlertKind, useAlertKindsOff } from "../state";

/**
 * Which alerts Rig raises on this device: a line on where they show and a
 * Settings row with a switch for each kind. It keeps its own preferences, so it can sit on any
 * page; Settings shows it as its Notifications section. Pass desktop in the
 * Rig app for Windows, where alerts also arrive as Windows notifications.
 */
export function NotificationSettings({ desktop = false }: { desktop?: boolean }) {
  const off = useAlertKindsOff();
  return (
    <>
      <p className="muted notify-note">
        {desktop
          ? "Rig puts these at the top of Things to look at, and sends a Windows notification when one starts while Rig's window isn't in front."
          : "Rig puts these at the top of Things to look at. The Rig app on each PC can also send a Windows notification."}
      </p>
      {alertRules.map((r) => {
        const on = !off.includes(r.kind);
        const id = `alert-kind-${r.kind}`;
        return (
          <SettingRow key={r.kind} id={id} title={r.label} body={r.description}>
            <button type="button" className="switch set-toggle" role="switch" aria-checked={on} aria-labelledby={id} onClick={() => setAlertKind(r.kind, !on)}><i /></button>
          </SettingRow>
        );
      })}
    </>
  );
}
