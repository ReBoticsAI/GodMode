/**
 * When Browser stage / agent browser tools are allowed on this install.
 * Local desktop (Electron / bare metal): on. GodMode Cloud SaaS: off until
 * disposable browser jobs (#780) or OS connectors (#339).
 */
import { config } from "../../config.js";

export function resolveBrowserStageAllowed(opts: {
  isSaas: boolean;
  envAllow?: string | undefined;
}): boolean {
  const raw = (opts.envAllow ?? "").trim();
  if (raw === "1" || raw.toLowerCase() === "true") return true;
  if (raw === "0" || raw.toLowerCase() === "false") return false;
  if (opts.isSaas) return false;
  return true;
}

export function browserStageAllowed(): boolean {
  return resolveBrowserStageAllowed({
    isSaas: config.isSaas,
    envAllow: process.env.PLATFORM_ALLOW_BROWSER_STAGE,
  });
}

export function browserStageDeniedMessage(): string {
  return (
    "Browser stage is disabled on this installation. " +
    "Use GodMode Local (desktop) for Browser MVP. " +
    "Cloud browser sessions wait on disposable jobs (#780) or OS connectors (#339)."
  );
}
