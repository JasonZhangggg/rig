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

## The mockups

Each one has its own layout and navigation, not just its own colors.

| Mockup | Home screen | Navigation |
| --- | --- | --- |
| **Mix** | A monochrome hero, then Blend's tiles: the 3D PC, health ring, fan dots, temperature capsules and gaming timeline on graphite. Color lives only in the tiles: one color for healthy, one for needs a look, one for expected. The page always shows the Greeting hero and the Ink PC. The tile colors come in three sets: Olive (the default, a dull pastel sage), Brass (pale gold, rust, warm grey) and Denim (a dull pastel blue). Olive and Denim run in three steps from deep to near white, so the lightest shade sits at the bottom. A switch picks Colors now or Colors before. Colors now, the default, keeps the data in warm greys with a little of the set: the peaks tinted, the fan dots in two shades, and full color only on the hottest reading, the hot part, the thing to look at and a small mark on the days that ran hot. Colors before uses the set everywhere. The 3D PC's glow, heat and airflow follow the set. | The Panel sidebar in paper tones, all graphite and grey, with your account at the bottom. |
| **Paper** | A hero card with a big sentence about your PC, the 3D PC on a soft dusk gradient, a dot-matrix peak temperature, capsule bars for each day and a list of things to look at. Coral marks only the one thing that needs a look. | A floating white sidebar with numbered links, an Ask Rig button and your account at the bottom. |
| **Signature** | A greeting, health as lime dot-matrix digits on a graphite tile, the 3D PC, a capsule temperature chart and a gaming timeline. Lime means healthy, coral means needs a look. | A floating white sidebar with icons and your account at the bottom, plus an Ask Rig bar on top. |
| **Pulse** | Dark cards with a health sparkline, a dot-matrix fan chart, the 3D PC, a capsule temperature chart and a gaming timeline in lime and orange. Has a light mode. | Pill buttons along the top and a rail of round buttons with your account at the bottom. |
| **Blend** | Friendly's greeting and tiles with Pulse's charts on black tiles, in lime. | The Panel sidebar with your account at the bottom. |
| **Friendly** | A greeting band ("Hey Jason, need help?") with a Watermelon "Fix what needs a look" button, then round tiles: the PC, a dark health ring, a mood check, fan bars, quick switches, days since the last dust clean, storage bubbles and a to-do list. | A framed app with a soft grey sidebar: grouped links, a black pill for the current screen, a setup card with Skip and Next, a button that collapses it to icons, and your account pinned at the bottom with a menu for settings, your PCs on the web and sign out. |
| **Canvas** | The PC in the middle of a dark dotted canvas, with each part as a card wired to it. A warm part's wire animates, and a "Rig" cursor points at it with a Fix it button. An ask box sits at the bottom. | Floating toolbars: screens on the left, one tab per PC in the middle, search and "Fix 1 issue" on the right. |
| **Workspace** | A big hottest-temperature number, a power-draw bar split by part, a black "Needs a look" card, the PC in 3D, a hatched bar chart, games and parts lists, and a stats row. | An icon rail plus a tree of your PCs and their parts, with the page on a lighter sheet. |

Friendly uses a Watermelon accent on a neutral background, and the 3D glow follows it. Every screen is tuned for it: bolder page titles, warnings and notes in the accent family instead of orange and blue, a calmer History chart, a full-height sign-in with the app's own logo, a check mark on the current PC, and short press and open animations that switch off with reduced motion.

**PC styles:** the 3D PC can be drawn four ways in any look, and Ink is the default. Real is lit like a product photo. Clay is one matte tone. Ink is flat color with drawn outlines. Drawing is a pen sketch on paper. The other looks, heroes and PC styles are still in the code but no longer in the mockup panel.

The other screens (3D view, Ask, Changes and the rest) are shared and take on each mockup's colors and type inside its navigation.

**Search:** Ctrl K (or /) opens one search box for parts, changes, games and upgrades, with tabs, counts and an "Ask Rig" row. Arrow keys move, Enter opens, Tab asks Rig.

The 3D PC follows the style too. It stands on a lit turntable, the case is lit from inside in the PC's own accent color, fans and light strips glow, a hot part pulses gently, and flow lines show air coming in cool at the front and leaving warm at the back (Airflow on the 3D page turns them off). On the dashboard it turns slowly and doesn't grab the scroll wheel.

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
    styles.css       shared styles, as tokens per style
    styles-v6.css    the three mockups: tokens, navigation and home screens
    components/      Shells.tsx (the three navigations), shared bits and the 3D stage
    pages/           one file per screen; pages/homes/ holds the three home screens
```
