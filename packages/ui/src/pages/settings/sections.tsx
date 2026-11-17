// The sections of Settings, in order. A new section is one entry here: the
// page, its side list and the Ctrl K search all read this list.

import type { ComponentType } from "react";
import type { Ctx } from "../../state";
import { AboutSection } from "./AboutSection";
import { AccountSection } from "./AccountSection";
import { AppSection } from "./AppSection";
import { DataSection } from "./DataSection";
import { NotificationsSection } from "./NotificationsSection";
import { UnitsSection } from "./UnitsSection";

export { SettingRow, SettingsSection, sectionAnchor } from "./parts";

export interface SettingsSectionDef {
  id: string;
  title: string;
  /** One line under the title, also shown in search. */
  intro: string;
  /** Extra words that find this section in Ctrl K search. */
  keywords: string;
  /** Leave out to always show. */
  show?: (ctx: Ctx) => boolean;
  Body: ComponentType;
}

export const settingsSections: SettingsSectionDef[] = [
  { id: "account", title: "Account", intro: "Who's signed in, and deleting the account.", keywords: "account sign in sign out email delete remove", Body: AccountSection },
  { id: "data", title: "Your data", intro: "A copy of everything Rig keeps for you.", keywords: "data download export backup json history copy", show: ({ client }) => !!client.exportData, Body: DataSection },
  { id: "units", title: "Units", intro: "How temperatures show on every screen.", keywords: "units temperature celsius fahrenheit degrees °c °f", Body: UnitsSection },
  { id: "notifications", title: "Notifications", intro: "Which problems Rig alerts you about on this device.", keywords: "notifications alerts alert notify warnings windows hot temperature fan stopped drive full disk space wearing", Body: NotificationsSection },
  { id: "app", title: "App", intro: "How the Rig app runs on this PC.", keywords: "app startup start with windows launch login autostart", show: ({ host }) => !!host.autostart, Body: AppSection },
  { id: "about", title: "About", intro: "Which version of Rig this is.", keywords: "about version release build number update server", Body: AboutSection },
];

let pending: string | null = null;
/** Asks the Settings page to scroll to a section once it opens (from search). */
export const focusSection = (id: string) => { pending = id; };
export const takeFocusSection = () => { const id = pending; pending = null; return id; };
