import { NotificationSettings } from "../../components/NotificationSettings";
import { useApp } from "../../state";

export function NotificationsSection() {
  const { client } = useApp();
  return <NotificationSettings desktop={client.kind === "desktop"} />;
}
