import { createContext, useContext } from "react";

/** Lets custom org-chart nodes toggle their own collapse state. */
export interface OrgCollapseContextValue {
  toggle: (id: string) => void;
}

export const OrgCollapseContext = createContext<OrgCollapseContextValue>({
  toggle: () => undefined,
});

export const useOrgCollapse = (): OrgCollapseContextValue =>
  useContext(OrgCollapseContext);
