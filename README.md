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
