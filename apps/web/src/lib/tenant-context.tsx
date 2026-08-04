import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  fetchAuthSession,
  fetchAuthTenants,
  getActiveTenantId,
  setActiveTenantId,
  type AuthUser,
  type TenantSummary,
} from "@/api";
import { clearActiveTenant } from "@/lib/storage-keys";

export interface TenantRefreshResult {
  authenticated: boolean;
  user: AuthUser | null;
  tenants: TenantSummary[];
}

interface TenantContextValue {
  user: AuthUser | null;
  authenticated: boolean;
  tenants: TenantSummary[];
  activeTenantId: string | null;
  setTenant: (id: string) => void;
  refresh: () => Promise<TenantRefreshResult>;
  loading: boolean;
}

const TenantContext = createContext<TenantContextValue | null>(null);

export function TenantProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [activeTenantId, setActiveTenantIdState] = useState<string | null>(
    getActiveTenantId()
  );
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<TenantRefreshResult> => {
    try {
      const session = await fetchAuthSession();
      if (!session.authenticated || !session.user) {
        setAuthenticated(false);
        setUser(null);
        setTenants([]);
        setActiveTenantIdState(null);
        clearActiveTenant();
        return { authenticated: false, user: null, tenants: [] };
      }
      setAuthenticated(true);
      setUser(session.user);
      const tenantList = await fetchAuthTenants();
      setTenants(tenantList.tenants);
      const stored = getActiveTenantId();
      const next =
        stored && tenantList.tenants.some((t) => t.id === stored)
          ? stored
          : session.tenantId ?? tenantList.tenants[0]?.id ?? null;
      if (next) {
        setActiveTenantId(next);
        setActiveTenantIdState(next);
      } else {
        clearActiveTenant();
        setActiveTenantIdState(null);
      }
      return {
        authenticated: true,
        user: session.user,
        tenants: tenantList.tenants,
      };
    } catch (err) {
      setAuthenticated(false);
      setUser(null);
      setTenants([]);
      setActiveTenantIdState(null);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => {
      /* initial load: unauthenticated */
    });
  }, [refresh]);

  const setTenant = useCallback((id: string) => {
    setActiveTenantId(id);
    setActiveTenantIdState(id);
    window.location.reload();
  }, []);

  const value = useMemo(
    () => ({ user, authenticated, tenants, activeTenantId, setTenant, refresh, loading }),
    [user, authenticated, tenants, activeTenantId, setTenant, refresh, loading]
  );

  return (
    <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
  );
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant requires TenantProvider");
  return ctx;
}
