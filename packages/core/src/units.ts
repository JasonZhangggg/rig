// Temperatures are measured and stored in °C everywhere. The screens show them
// in the unit the viewer picked, through formatTemp.

export type TempUnit = "c" | "f";
export const tempUnits: readonly TempUnit[] = ["c", "f"];
export const isTempUnit = (v: unknown): v is TempUnit => v === "c" || v === "f";
/** "°C" or "°F", for headings like "This week, °F". */
export const tempMark = (unit: TempUnit) => (unit === "c" ? "°C" : "°F");

export interface TempFormat {
  /** A difference between two temperatures, like "8° under the limit": scaled but not offset. */
  delta?: boolean;
  /** "unit" writes °C or °F, "degree" just °, "none" the bare number. Default "unit". */
  mark?: "unit" | "degree" | "none";
  /** Decimal places. Default 0. */
  digits?: number;
  /** Put a + in front of positive numbers. */
  sign?: boolean;
}

/** A Celsius reading (or difference, with delta) in the given unit, unrounded. */
export function toUnit(celsius: number, unit: TempUnit, delta = false): number {
  if (unit === "c") return celsius;
  return delta ? celsius * 1.8 : celsius * 1.8 + 32;
}

/** A Celsius temperature as the viewer reads it: "72°C", "162°F", "+5°", "–" when there's no reading. */
export function formatTemp(celsius: number | null | undefined, unit: TempUnit, opts: TempFormat = {}): string {
  if (celsius == null || !Number.isFinite(celsius)) return "–";
  const v = toUnit(celsius, unit, opts.delta);
  const digits = opts.digits ?? 0;
  const fixed = v.toFixed(digits);
  // -0 from rounding a small negative difference reads as 0.
  const text = Number(fixed) === 0 ? (0).toFixed(digits) : fixed;
  const plus = opts.sign && Number(text) > 0 ? "+" : "";
  const mark = opts.mark ?? "unit";
  return `${plus}${text}${mark === "none" ? "" : mark === "degree" ? "°" : tempMark(unit)}`;
}

const absolute = /(-?\d+(?:\.\d+)?)\s?°C\b/g;
const difference = /(\d+(?:\.\d+)?)°(?![CF])/g;

/**
 * Rewrites the temperatures in a sentence written in °C, such as a finding's
 * title from the PC: "88°C" becomes "190°F" and a bare difference like
 * "8° under" becomes "14° under". Text in °C is returned as it is.
 */
export function tempsInText(text: string, unit: TempUnit): string {
  if (unit === "c") return text;
  return text
    .replace(absolute, (_m, n: string) => formatTemp(Number(n), unit))
    .replace(difference, (_m, n: string) => formatTemp(Number(n), unit, { delta: true, mark: "degree" }));
}
