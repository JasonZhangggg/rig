// Dates and times in the viewer's own words. Date's toLocaleTimeString with options builds a new formatter on every
// call, about 60 µs; one formatter kept per set of options takes about 1 µs, which matters in charts, lanes and lists
// that redraw with every reading.
const kept = new Map<string, Intl.DateTimeFormat>();

/** The same words as the date's own toLocaleString with these options, from a formatter made once for them. */
export function dateText(date: Date | number, o: Intl.DateTimeFormatOptions): string {
  const t = +date;
  if (!Number.isFinite(t)) return "Invalid Date";
  const key = JSON.stringify(o);
  let f = kept.get(key);
  if (!f) kept.set(key, (f = new Intl.DateTimeFormat(undefined, o)));
  return f.format(t);
}
