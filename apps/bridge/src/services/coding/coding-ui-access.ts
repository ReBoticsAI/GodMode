import { config } from "../../config.js";

/** Human Coding workspace + mention-paths: same SaaS gate as agent codeAccess. */
export function codingUiAllowed(opts?: {
  isSaas?: boolean;
  saasAllowCodeAccess?: boolean;
}): boolean {
  const isSaas = opts?.isSaas ?? config.isSaas;
  const allow = opts?.saasAllowCodeAccess ?? config.saasAllowCodeAccess;
  if (isSaas && !allow) return false;
  return true;
}
