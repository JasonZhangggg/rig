import { useEffect, useState } from "react";
import { useApp } from "../../state";

export function AppSection() {
  const { host, toast } = useApp();
  const auto = host.autostart!;
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    auto.get().then((v) => live && setOn(v)).catch(() => live && setOn(false));
    return () => { live = false; };
  }, [auto]);

  const flip = async () => {
    if (on == null) return;
    const next = !on;
    setOn(next);
    try { await auto.set(next); } catch (e) {
      setOn(!next);
      toast(`Couldn't change that. ${e instanceof Error ? e.message : ""}`.trim());
    }
  };

  return (
    <div className="switch-list set-switches">
      <button type="button" className="switch" role="switch" aria-checked={!!on} disabled={on == null} onClick={flip}>
        <span><b>Start Rig with Windows</b><small>Rig opens when you sign in to Windows, so temperatures keep being recorded. Windows asks for permission each time, as it does when you open Rig.</small></span><i />
      </button>
    </div>
  );
}
