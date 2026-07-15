import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Shared className merge utility for plugin web bundles. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export { StructureTabGroupPage } from "../../../apps/web/src/components/StructureTabGroupPage.js";
