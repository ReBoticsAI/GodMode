import { contextBridge } from "electron";

/** Intentional empty preload — UI talks to Bridge over localhost HTTP only. */
contextBridge.exposeInMainWorld("godmodeDesktop", {
  surface: "electron",
});
