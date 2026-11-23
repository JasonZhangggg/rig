import { useActions } from "../../state";
import { rigVersion } from "../../version";
import { SettingRow } from "./parts";

export function AboutSection() {
  const { host } = useActions();
  return (
    <>
      <SettingRow title="Version" body={`Rig ${rigVersion}`} />
      {host.server && <SettingRow title="Server" body={`Signs in and syncs with ${host.server}`} />}
      {host.openLogs && (
        <SettingRow title="Logs" body="What Rig did and how long each step took. Send Rig.log along when something goes wrong.">
          <button className="btn" type="button" onClick={() => void host.openLogs!().catch(() => {})}>Open logs folder</button>
        </SettingRow>
      )}
    </>
  );
}
