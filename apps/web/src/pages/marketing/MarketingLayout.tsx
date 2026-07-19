import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import {
  BookOpenIcon,
  ChevronRightIcon,
  CloudIcon,
  ContactIcon,
  DollarSignIcon,
  ExternalLinkIcon,
  HomeIcon,
  LayoutGridIcon,
  MenuIcon,
  ScaleIcon,
  ShieldIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/PageHeader";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { APP_NAME } from "@/lib/navigation";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { getFeatureDoc } from "@/lib/feature-docs";

export const MARKETING_BASE = "/www";

const NAV_ITEMS = [
  { to: MARKETING_BASE, end: true, label: "Home", Icon: HomeIcon },
  { to: `${MARKETING_BASE}/features`, label: "Features", Icon: LayoutGridIcon },
  { to: `${MARKETING_BASE}/pricing`, label: "Pricing", Icon: DollarSignIcon },
  { to: `${MARKETING_BASE}/security`, label: "Security", Icon: ShieldIcon },
  { to: `${MARKETING_BASE}/contact`, label: "Contact", Icon: ContactIcon },
  { to: `${MARKETING_BASE}/terms`, label: "Terms", Icon: ScaleIcon },
  { to: `${MARKETING_BASE}/privacy`, label: "Privacy", Icon: BookOpenIcon },
] as const;

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
    isActive
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-muted-foreground"
  );

function MarketingSidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <div className="flex w-full justify-center px-2 py-1.5">
        <NavLink
          to={MARKETING_BASE}
          end
          onClick={onNavigate}
          className="font-heading truncate text-4xl font-extrabold leading-none tracking-tight transition-opacity hover:opacity-80"
          aria-label="Go to marketing home"
        >
          {APP_NAME}
        </NavLink>
      </div>

      <nav
        aria-label="Primary"
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1"
      >
        <p className="px-3 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
          Website
        </p>
        {NAV_ITEMS.map(({ to, label, Icon, ...rest }) => (
          <NavLink
            key={to}
            to={to}
            end={"end" in rest ? rest.end : false}
            onClick={onNavigate}
            className={navLinkClass}
          >
            <Icon className="size-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-1 pt-2">
        <NavLink to="/" onClick={onNavigate} className={navLinkClass}>
          <CloudIcon className="size-4 shrink-0" />
          Open Cloud
        </NavLink>
        <a
          href="https://github.com/ReBoticsAI/GodMode"
          target="_blank"
          rel="noreferrer"
          onClick={onNavigate}
          className={navLinkClass({ isActive: false })}
        >
          <ExternalLinkIcon className="size-4 shrink-0" />
          GitHub
        </a>
      </div>
    </>
  );
}

function MarketingHeader({ onOpenNav }: { onOpenNav?: () => void }) {
  const { pathname } = useLocation();
  const crumb = useMemo(() => {
    const featureMatch = pathname.match(
      new RegExp(`^${MARKETING_BASE}/features(?:/([^/]+))?$`)
    );
    if (featureMatch) {
      if (featureMatch[1]) {
        return getFeatureDoc(featureMatch[1])?.title ?? "Feature";
      }
      return "Features";
    }
    const item = NAV_ITEMS.find((n) =>
      n.to === MARKETING_BASE
        ? pathname === MARKETING_BASE || pathname === `${MARKETING_BASE}/`
        : pathname === n.to || pathname.startsWith(`${n.to}/`)
    );
    return item?.label ?? "Website";
  }, [pathname]);

  return (
    <header className="flex h-9 shrink-0 items-center gap-2 border-b bg-sidebar/60 px-2 text-xs sm:px-3">
      {onOpenNav ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="-ml-1 shrink-0 lg:hidden"
          onClick={onOpenNav}
          aria-label="Open navigation menu"
        >
          <MenuIcon />
        </Button>
      ) : null}
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 flex-1 items-center gap-1 truncate text-muted-foreground"
      >
        <span className="truncate font-medium text-foreground sm:hidden">
          {crumb}
        </span>
        <span className="hidden items-center gap-1 sm:flex">
          <span className="truncate">Website</span>
          <ChevronRightIcon className="size-3 shrink-0 opacity-50" />
          <span className="truncate font-medium text-foreground">{crumb}</span>
        </span>
      </nav>
      <Button size="sm" variant="outline" className="hidden sm:inline-flex" render={<Link to="/" />}>
        Open Cloud
      </Button>
    </header>
  );
}

function MarketingFooter() {
  return (
    <footer className="flex h-9 shrink-0 items-center gap-3 border-t bg-sidebar/40 px-3 font-mono text-xs uppercase tracking-wide text-muted-foreground">
      <span className="truncate text-[10px] normal-case tracking-normal">
        {APP_NAME}
      </span>
      <span className="ml-auto truncate text-[10px] normal-case tracking-normal">
        Public site · Stripe business website
      </span>
    </footer>
  );
}

/**
 * Same shell as the authenticated app: left sidebar rail, header breadcrumb,
 * scrollable main, mono footer. Public marketing routes only.
 */
export function MarketingLayout() {
  const isMobile = useIsMobile();
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isMobile) setNavOpen(false);
  }, [isMobile]);

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <aside className="hidden h-dvh w-56 shrink-0 flex-col gap-2 border-r bg-sidebar p-3 text-sidebar-foreground lg:flex">
        <MarketingSidebarContent />
      </aside>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent
          side="left"
          className="flex w-72 max-w-[85vw] flex-col gap-2 bg-sidebar p-3 text-sidebar-foreground"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <MarketingSidebarContent onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <MarketingHeader onOpenNav={() => setNavOpen(true)} />
        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <Outlet />
        </main>
        <MarketingFooter />
      </div>
    </div>
  );
}

export function MarketingProse({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Page>
      <PageHeader title={title} description={description} />
      <div className="flex max-w-2xl flex-col gap-4 text-sm leading-relaxed text-muted-foreground [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:ml-4 [&_li]:list-disc [&_strong]:text-foreground [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
        {children}
      </div>
    </Page>
  );
}
