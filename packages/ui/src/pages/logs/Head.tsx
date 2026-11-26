import type { ReactNode } from "react";
import type { Route } from "@rig/core";
import { useUI } from "../../state";

/** The two views of the Logs page, each its own address so a link opens the right one. Older addresses open Readings. */
export const logViews: [Route, string][] = [["logs", "Readings"], ["events", "Events"]];
const viewOf = (r: Route): Route => (r === "recorded" || r === "history" ? "logs" : r);
export const isLogView = (r: Route) => logViews.some(([v]) => v === viewOf(r));

/** The Logs page head, shared by its views: what this view shows, and a row to switch views. */
export function LogsHead({ sub, right }: { sub: string; right?: ReactNode }) {
  const ui = useUI();
  return (
    <div className="lg-head">
      <div className="page-head">
        <div><h1>Logs</h1><p className="sub">{sub}</p></div>
        {right}
      </div>
      <nav className="lg-views" aria-label="Logs">
        {logViews.map(([r, label]) => <a key={r} href={`#${r}`} aria-current={viewOf(ui.route) === r ? "page" : undefined}>{label}</a>)}
      </nav>
    </div>
  );
}
