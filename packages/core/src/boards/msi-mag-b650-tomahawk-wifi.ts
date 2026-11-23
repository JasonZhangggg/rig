// MSI MAG B650 TOMAHAWK WIFI. Prototype layout: positions placed by hand from the
// ATX spacing rules and the board's known header names, not yet traced from the
// manual's "Overview of Components" page, so they can be off by about 10 mm.
// Units mm, from the top rear corner of the board: u toward the front, v down.
import type { BoardShape } from "../build";

const fan = (id: string, name: string, label: string, u: number, v: number, rotate = false) => ({
  id, name, label, kind: "fan" as const, u, v, w: rotate ? 3 : 10, h: rotate ? 10 : 3,
  pins: { cols: rotate ? 1 : 4, rows: rotate ? 4 : 1, names: ["Ground", "+12V", "Speed", "PWM"] },
});

export const msiMagB650TomahawkWifi: Omit<BoardShape, "source"> = {
  model: "MSI MAG B650 TOMAHAWK WIFI",
  form: "atx", w: 244, h: 305, color: "#1f2124",
  layoutFrom: "Placed by hand from the board's header names, so they can be about 10 mm out. Not yet traced from the manual's board drawing.",
  items: [
    { id: "io", name: "Rear I/O", label: "Rear ports", kind: "io", u: 0, v: 6, w: 24, h: 150 },
    { id: "vrm-top", name: "", label: "Power heatsink", kind: "heatsink", u: 48, v: 9, w: 96, h: 20 },
    { id: "vrm-left", name: "", label: "Power heatsink", kind: "heatsink", u: 26, v: 30, w: 20, h: 96 },
    { id: "socket", name: "AM5", label: "Processor socket", kind: "socket", u: 84, v: 50, w: 42, h: 42 },
    { id: "eps", name: "CPU_PWR1", label: "Processor power (8-pin)", kind: "power", u: 26, v: 1, w: 19, h: 9, pins: { cols: 4, rows: 2 } },
    { id: "eps2", name: "CPU_PWR2", label: "Processor power (4-pin)", kind: "power", u: 48, v: 1, w: 10, h: 9, pins: { cols: 2, rows: 2 } },
    fan("cpu-fan", "CPU_FAN1", "Processor fan", 150, 3),
    fan("pump-fan", "PUMP_FAN1", "Pump or fan", 166, 3),
    fan("sys-fan1", "SYS_FAN1", "Case fan 1", 2, 162, true),
    fan("sys-fan2", "SYS_FAN2", "Case fan 2", 232, 172),
    fan("sys-fan3", "SYS_FAN3", "Case fan 3", 180, 296),
    fan("sys-fan4", "SYS_FAN4", "Case fan 4", 196, 296),
    { id: "dimm-0", name: "A1", label: "Memory slot A1", kind: "dimm", u: 160, v: 14, w: 6, h: 133 },
    { id: "dimm-1", name: "A2", label: "Memory slot A2", kind: "dimm", u: 170, v: 14, w: 6, h: 133 },
    { id: "dimm-2", name: "B1", label: "Memory slot B1", kind: "dimm", u: 184, v: 14, w: 6, h: 133 },
    { id: "dimm-3", name: "B2", label: "Memory slot B2", kind: "dimm", u: 194, v: 14, w: 6, h: 133 },
    { id: "atx24", name: "ATX_PWR1", label: "24-pin power", kind: "power", u: 234, v: 92, w: 8, h: 52, pins: { cols: 2, rows: 12 } },
    { id: "jusb-c", name: "JUSB3", label: "USB-C front header", kind: "usb", u: 232, v: 150, w: 9, h: 9 },
    { id: "jusb-31", name: "JUSB4", label: "USB 3 front header (19-pin)", kind: "usb", u: 236, v: 186, w: 6, h: 25, pins: { cols: 2, rows: 10, missing: [19] } },
    { id: "sata", name: "SATA1-4", label: "SATA ports", kind: "sata", u: 230, v: 218, w: 13, h: 34 },
    { id: "m2-1", name: "M2_1", label: "M.2 slot (processor, fastest)", kind: "m2", u: 50, v: 128, w: 80, h: 24 },
    { id: "pcie1", name: "PCI_E1", label: "Graphics card slot", kind: "pcie", u: 42, v: 158, w: 89, h: 7 },
    { id: "m2-2", name: "M2_2", label: "M.2 slot (processor)", kind: "m2", u: 50, v: 172, w: 80, h: 22 },
    { id: "pcie2", name: "PCI_E2", label: "PCIe x1 slot", kind: "pcie", u: 42, v: 200, w: 25, h: 7 },
    { id: "chipset", name: "", label: "Chipset heatsink", kind: "chipset", u: 150, v: 196, w: 70, h: 62 },
    { id: "m2-3", name: "M2_3", label: "M.2 slot (chipset)", kind: "m2", u: 60, v: 212, w: 80, h: 22 },
    { id: "pcie3", name: "PCI_E3", label: "PCIe x16 slot (x4 speed)", kind: "pcie", u: 42, v: 240, w: 89, h: 7 },
    { id: "jaud", name: "JAUD1", label: "Front audio header", kind: "audio", u: 6, v: 295, w: 13, h: 5, pins: { cols: 5, rows: 2, missing: [7] } },
    { id: "jrgb", name: "JRGB1", label: "12V RGB header", kind: "rgb", u: 30, v: 297, w: 10, h: 3, pins: { cols: 4, rows: 1, names: ["+12V", "Green", "Red", "Blue"] } },
    { id: "jargb1", name: "JARGB_V2_1", label: "5V ARGB header", kind: "rgb", u: 46, v: 297, w: 8, h: 3, pins: { cols: 4, rows: 1, missing: [2], names: ["+5V", "Data", "", "Ground"] } },
    { id: "jargb2", name: "JARGB_V2_2", label: "5V ARGB header", kind: "rgb", u: 60, v: 297, w: 8, h: 3, pins: { cols: 4, rows: 1, missing: [2], names: ["+5V", "Data", "", "Ground"] } },
    { id: "jusb1", name: "JUSB1", label: "USB 2 front header", kind: "usb", u: 120, v: 295, w: 13, h: 5, pins: { cols: 5, rows: 2, missing: [8] } },
    { id: "jusb2", name: "JUSB2", label: "USB 2 front header", kind: "usb", u: 140, v: 295, w: 13, h: 5, pins: { cols: 5, rows: 2, missing: [8] } },
    {
      id: "fp", name: "JFP1", label: "Front panel header", kind: "front-panel", u: 214, v: 294, w: 13, h: 5,
      pins: { cols: 5, rows: 2, missing: [9], names: ["HDD LED +", "HDD LED −", "Reset", "Reset", "Reserved", "Power LED +", "Power LED −", "Power switch", "Power switch", ""] },
    },
    { id: "fp2", name: "JFP2", label: "Speaker and buzzer", kind: "front-panel", u: 230, v: 294, w: 8, h: 5, pins: { cols: 2, rows: 2 } },
  ],
};
