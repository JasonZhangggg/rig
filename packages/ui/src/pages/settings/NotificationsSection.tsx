import { NotificationSettings } from "../../components/NotificationSettings";
import { setRecordingNotice, useApp, useRecordingNoticeOn } from "../../state";
import { SettingRow } from "./parts";

export function NotificationsSection() {
  const { client } = useApp();
  const recordingOn = useRecordingNoticeOn();
  return (
    <>
      <NotificationSettings desktop={client.kind === "desktop"} />
      {client.caps.local && (
        <SettingRow id="notify-recording" title="A recording finished" body="A Windows notification when a recording Rig made on this PC is done, so you can see what it found.">
          <button type="button" className="switch set-toggle" role="switch" aria-checked={recordingOn} aria-labelledby="notify-recording" onClick={() => setRecordingNotice(!recordingOn)}><i /></button>
        </SettingRow>
      )}
    </>
  );
}
