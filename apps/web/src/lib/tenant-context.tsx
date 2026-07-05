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

interface TenantContextValue {
  user: AuthUser | null;
  authenticated: boolean;
  tenants: TenantSummary[];
  activeTenantId: string | null;
  setTenant: (id: string) => void;
  refresh: () => Promise<void>;
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

  const refresh = useCallback(async () => {
    try {
      const session = await fetchAuthSession();
      if (!session.authenticated || !session.user) {
        setAuthenticated(false);
        setUser(null);
        setTenants([]);
        return;
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
      }
    } catch {
      setAuthenticated(false);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
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
