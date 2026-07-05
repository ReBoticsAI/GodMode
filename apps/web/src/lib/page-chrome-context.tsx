import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface PageChromeContextValue {
  /** When set, replaces the default header right content. */
  headerOverride: ReactNode | null;
  /** When set, replaces the default footer right content. */
  footerOverride: ReactNode | null;
  setHeaderOverride: (node: ReactNode | null) => void;
  setFooterOverride: (node: ReactNode | null) => void;
}

const PageChromeContext = createContext<PageChromeContextValue | null>(null);

/**
 * Lets individual pages temporarily replace the default header/footer chrome.
 * The default chrome (user info) renders whenever no page sets an override.
 */
export function PageChromeProvider({ children }: { children: ReactNode }) {
  const [headerOverride, setHeaderOverride] = useState<ReactNode | null>(null);
  const [footerOverride, setFooterOverride] = useState<ReactNode | null>(null);

  const value = useMemo<PageChromeContextValue>(
    () => ({
      headerOverride,
      footerOverride,
      setHeaderOverride,
      setFooterOverride,
    }),
    [headerOverride, footerOverride]
  );

  return (
    <PageChromeContext.Provider value={value}>
      {children}
    </PageChromeContext.Provider>
  );
}

export function usePageChrome(): PageChromeContextValue {
  const ctx = useContext(PageChromeContext);
  if (!ctx) {
    throw new Error("usePageChrome must be used within PageChromeProvider");
  }
  return ctx;
}

/**
 * Convenience hook for pages that need custom chrome: sets the header/footer
 * overrides on mount and clears them on unmount (or when the nodes change).
 */
export function usePageChromeOverride({
  header,
  footer,
}: {
  header?: ReactNode;
  footer?: ReactNode;
}): void {
  const ctx = useContext(PageChromeContext);
  useEffect(() => {
    if (!ctx) return;
    if (header !== undefined) ctx.setHeaderOverride(header);
    if (footer !== undefined) ctx.setFooterOverride(footer);
    return () => {
      if (header !== undefined) ctx.setHeaderOverride(null);
      if (footer !== undefined) ctx.setFooterOverride(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header, footer]);
}
