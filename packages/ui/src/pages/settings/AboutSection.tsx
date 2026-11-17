import { useApp } from "../../state";
import { rigVersion } from "../../version";
import { SettingRow } from "./parts";

export function AboutSection() {
  const { host } = useApp();
  return (
    <>
      <SettingRow title="Version" body={`Rig ${rigVersion}`} />
      {host.server && <SettingRow title="Server" body={`Signs in and syncs with ${host.server}`} />}
    </>
  );
}
