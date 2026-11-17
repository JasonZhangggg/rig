# Rig

Rig is a PC helper app. It shows your computer as a 3D model you can click into, explains what's wrong in plain words, answers questions from your parts' own manuals, and fixes things for you, always asking first and keeping a one-tap undo for every change.

Windows comes first. A Mac version comes later.

## Status

Design stage. The `app/` folder holds clickable mockups with sample data so we can agree on the screens and the look before building the real thing. Nothing reads your hardware yet.

## Planned stack

- **Desktop shell:** [Tauri](https://tauri.app) with a Rust core. Small installs and low memory use, and a clean security model for the parts of the app that change system settings.
- **Interface:** TypeScript and React (the mockups in `app/` are written this way so they carry straight into the Tauri app).
- **3D:** three.js.
- **Hardware readings on Windows:** a small C# helper built on [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor), run as a Tauri sidecar. Only the helper asks for admin rights, and only for the actions that need them.
- **Accounts and sync:** sign in once, and every PC shows up on a web version too.

## Open the mockups

You need [Node.js](https://nodejs.org) 18 or newer. This works the same on Windows and Mac.

```
cd app
npm install
npm run dev
```

Then open the address it prints (usually http://localhost:5173).

To get a single file you can double-click or send to someone:

```
cd app
npm run build:single
```

That writes `app/dist-single/index.html`, which opens in any browser with no server.

The dark panel in the bottom-right corner is only for the mockups. It switches between the three styles, between a tower and a laptop, and to the sign-in and web screens.

## What's in the mockups

- **Overview:** your PC in 3D, a health score, what needs attention, live readings and recent changes.
- **Your PC in 3D:** click any part for temperatures, specs, its manual and driver updates. Exploded view pulls the parts apart. Heat view tints parts by temperature. You can name the PC and pick its accent color, which is how you tell your PCs apart.
- **Ask:** answers with sources (manuals, maker pages, your own readings). When it suggests a fix, it shows every setting before and after and waits for your yes.
- **Changes:** every change with its old and new values, who made it, and one-tap undo from a restore point.
- **Upgrades:** what fits your exact case, board and power supply, with free slots shown.
- **Games:** settings measured on your PC, shown as before and after.
- **Temperature history:** a week of readings with gaming sessions marked, and the trends that matter.
- **Web:** all your signed-in PCs in one place, with when each last synced.
- **Sign in.**

All data is sample data.

## The three styles

| Style | Feel | Navigation |
| --- | --- | --- |
| **Soft** | Light, calm and rounded. Plenty of air without wasted space. | Sidebar in two sections, with a setup card |
| **Night** | A dark canvas for people who want every number. No glow, no neon. | Sidebar in two sections, with a setup card |
| **Warm** | Warm neutrals and bolder nested panels, for people who just want their PC to work. | Tabs along the top, in two groups |

Every style shares the same dashboard: the 3D PC, a health score, a strip of live readings with how they changed, a week of temperatures, and recent changes.

**Search:** Ctrl K (or /) opens one search box for parts, changes, games and upgrades, with tabs, counts and an "Ask Rig" row. Arrow keys move, Enter opens, Tab asks Rig.

The 3D PC follows the style too: rounded parts, glass and clearcoat materials, a perforated front panel, curved fan blades, real cable runs and a soft shadow under the case. On the dashboard it turns slowly and doesn't grab the scroll wheel.

Each PC's accent color is kept separate from the style's colors, so it reads as "this is my PC" in every style.

## 3D models

The mockups draw every part from simple shapes in code, so any PC gets a model straight away. The plan for the real app:

1. Detect the case, motherboard and graphics card by model name.
2. Where a real model exists for that exact part, use it.
3. Otherwise fall back to the drawn model, sized from the part's real dimensions (case height, GPU length and slot count, board size), so it still looks like your PC.

## Code layout

```
app/
  src/
    App.tsx          routes and keeping the 3D scene in step with the screens
    state.tsx        app state (route, style, selected part, changes)
    data.ts          sample PCs, chat, changes, upgrades, games
    scene.ts         the three.js scene: tower, laptop, exploded and heat views
    themes.ts        the three styles and their 3D lighting
    styles.css       all styles, as tokens per style
    components/      shell, shared bits and the shared 3D stage
    pages/           one file per screen
```
