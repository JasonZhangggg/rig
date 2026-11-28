// What a startup app is, for apps Rig knows by name, and whether it's fine to turn off. Written by hand: an app Rig
// doesn't know gets nothing, rather than a guess.

/** off: opens fine when you start it yourself. keep: a driver, security, sync, or a device that needs it running. */
export type StartupSuggestion = "off" | "keep";

export interface StartupGuide {
  /** One short line: what the app is. */
  what: string;
  suggest?: StartupSuggestion;
}

type Entry = [RegExp, string, StartupSuggestion?];

// Most specific first: the first match wins.
const GUIDE: Entry[] = [
  // Games and launchers
  [/\bsteam\b/i, "Game store and launcher", "off"],
  [/\bepic\s*games/i, "Game store and launcher", "off"],
  [/\bea\s*(app|desktop)\b|^origin\b/i, "EA's game launcher", "off"],
  [/ubisoft|uplay/i, "Ubisoft's game launcher", "off"],
  [/battle\.?net|blizzard/i, "Blizzard's game launcher", "off"],
  [/\bgog\s*galaxy/i, "Game store and launcher", "off"],
  [/riot\s*client/i, "Riot's game launcher", "off"],
  [/xbox\s*app|gaming\s*services/i, "Xbox app for PC games", "off"],
  [/wallpaper\s*engine/i, "Moving wallpapers", "off"],
  [/medal\b|overwolf/i, "Game clips and overlays", "off"],

  // Chat, calls and music
  [/discord/i, "Chat and voice for games", "off"],
  [/spotify/i, "Music", "off"],
  [/\bskype\b/i, "Calls and chat", "off"],
  [/\bzoom\b/i, "Video calls", "off"],
  [/\bslack\b/i, "Work chat"],
  [/microsoft\s*teams|\bms-?teams\b|^teams\b/i, "Chat and meetings for work or school"],
  [/whatsapp/i, "Chat", "off"],
  [/telegram/i, "Chat", "off"],
  [/itunes\s*helper/i, "Helps iTunes find iPhones", "off"],

  // Browsers and Windows extras
  [/opera\s*gx|\bopera\b/i, "Web browser", "off"],
  [/microsoft\s*edge|msedge/i, "Web browser", "off"],
  [/google\s*chrome|\bchrome\b/i, "Web browser", "off"],
  [/\bbrave\b/i, "Web browser", "off"],
  [/\bfirefox\b/i, "Web browser", "off"],
  [/cortana/i, "Windows' voice assistant", "off"],
  [/copilot/i, "Windows' AI assistant", "off"],

  // Sync: files only stay backed up while it runs
  [/onedrive/i, "Keeps your files backed up to OneDrive", "keep"],
  [/dropbox/i, "Keeps your files backed up to Dropbox", "keep"],
  [/google\s*drive|googledrivefs/i, "Keeps your files backed up to Google Drive", "keep"],
  [/icloud/i, "Keeps your photos and files in iCloud", "keep"],

  // Creative apps and updaters
  [/adobe|creative\s*cloud|\bccx\s*process/i, "Adobe's app manager and updates", "off"],

  // Graphics
  [/nvidia\s*broadcast/i, "Mic and camera effects", "off"],
  [/geforce\s*experience|nvidia\s*app\b|nvidia\s*share/i, "NVIDIA's driver updates and game overlay", "off"],
  [/amd\s*(software|adrenalin)|radeon\s*software|\bcncmd\b/i, "AMD's graphics settings and updates", "off"],

  // Devices whose lighting, buttons or sound need it running
  [/logi(tech)?\s*g\s*hub|\blghub\b/i, "Mouse and keyboard buttons and lighting", "keep"],
  [/logi\s*options/i, "Mouse and keyboard buttons", "keep"],
  [/razer\s*(synapse|central|cortex)/i, "Razer devices' buttons and lighting", "keep"],
  [/corsair|\bicue\b/i, "Corsair devices' fans and lighting", "keep"],
  [/steelseries/i, "SteelSeries devices' buttons and lighting", "keep"],
  [/armoury\s*crate/i, "ASUS lighting, fans and drivers", "keep"],
  [/realtek|\brtkaud|\brthdvcpl/i, "Sound driver", "keep"],
  [/nahimic|sonic\s*studio|dolby|dts\s*(audio|sound)|waves\s*maxx/i, "Sound effects driver", "keep"],
  [/synaptics|\bsyntp|\belan\b|\betd\s*ctrl|precision\s*touchpad/i, "Touchpad driver", "keep"],
  [/\bintel\b.*(graphics|hd|rst|optane|management)/i, "Intel driver helper", "keep"],

  // Laptop makers' tools
  [/myasus/i, "ASUS's laptop tools and updates", "keep"],
  [/lenovo\s*vantage|lenovo/i, "Lenovo's laptop tools and updates", "keep"],
  [/dell\b|alienware/i, "Dell's tools and updates", "keep"],
  [/\bhp\b|omen\s*gaming/i, "HP's tools and updates", "keep"],
  [/\bmsi\b|dragon\s*center/i, "MSI's tools and updates", "keep"],
  [/\bacer\b|predatorsense|nitrosense/i, "Acer's tools and updates", "keep"],

  // Security and passwords
  [/windows\s*security|securityhealth/i, "Windows Security", "keep"],
  [/defender/i, "Virus protection", "keep"],
  [/norton|mcafee|avast|\bavg\b|bitdefender|kaspersky|\beset\b|malwarebytes|sophos|trend\s*micro|webroot|avira/i, "Virus protection", "keep"],
  [/1password|bitwarden|lastpass|dashlane|keeper|nordpass|proton\s*pass/i, "Password manager", "keep"],
  [/nordvpn|expressvpn|proton\s*vpn|surfshark|\bvpn\b/i, "VPN", "keep"],
];

/** What a startup app is, and whether Rig suggests turning it off. Null for an app Rig doesn't know. */
export function startupGuide(name: string): StartupGuide | null {
  const hit = GUIDE.find(([re]) => re.test(name));
  return hit ? { what: hit[1], ...(hit[2] ? { suggest: hit[2] } : {}) } : null;
}

/** The apps that start with Windows now and that Rig suggests turning off. */
export const suggestedOff = <T extends { name: string; enabled: boolean }>(apps: T[]): T[] => apps.filter((a) => a.enabled && startupGuide(a.name)?.suggest === "off");
