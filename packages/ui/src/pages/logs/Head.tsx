import type { ReactNode } from "react";
import type { Route } from "@rig/core";
import { useApp } from "../../state";

/** The views of the Logs page, each its own address so a link opens the right one. */
export const logViews: [Route, string][] = [["logs", "Events"], ["history", "Performance"]];
export const isLogView = (r: Route) => logViews.some(([v]) => v === r);

/** The Logs page head, shared by its views: what this view shows, and a row to switch views. */
export function LogsHead({ sub, right }: { sub: string; right?: ReactNode }) {
  const { ui } = useApp();
  return (
    <>
      <div className="page-head">
        <div><h1>Logs</h1><p className="sub">{sub}</p></div>
        {right}
      </div>
      <nav className="lg-views" aria-label="Logs">
        {logViews.map(([r, label]) => <a key={r} href={`#${r}`} aria-current={ui.route === r ? "page" : undefined}>{label}</a>)}
      </nav>
    </>
  );
}
