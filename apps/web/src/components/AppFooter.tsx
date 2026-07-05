import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  APP_NAME,
  divisionFromPath,
  isChromelessPath,
} from "@/lib/navigation";
import { useStructure } from "@/lib/structure-context";
import { usePageChrome } from "@/lib/page-chrome-context";
import { webPluginRuntime } from "@/plugins/runtime";

function formatClock(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function PlatformFooter() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <span className="truncate text-[10px] normal-case tracking-normal text-muted-foreground">
        {APP_NAME}
      </span>
      <span className="ml-auto tabular-nums text-foreground">{formatClock(now)}</span>
    </>
  );
}

export function AppFooter() {
  const { pathname } = useLocation();
  const { departments } = useStructure();
  const { footerOverride } = usePageChrome();

  const chromeless = isChromelessPath(pathname);
  const division = chromeless
    ? undefined
    : divisionFromPath(pathname, departments);
  const FooterPluginChrome = division?.rightSidebar
    ? webPluginRuntime.shellForSlot(division.rightSidebar, "footer")
    : null;

  return (
    <footer className="flex h-9 shrink-0 items-center gap-3 border-t bg-sidebar/40 px-3 font-mono text-xs uppercase tracking-wide text-muted-foreground">
      {footerOverride ? (
        footerOverride
      ) : FooterPluginChrome ? (
        <FooterPluginChrome />
      ) : (
        <PlatformFooter />
      )}
    </footer>
  );
}
