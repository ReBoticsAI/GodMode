import { app, BrowserWindow, dialog } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";
import {
  appendLog,
  ensureRuntimeDependencies,
  freePort,
  nodeBinary,
  openLogFile,
  runtimeRoot,
  spawnHost,
  spawnSupervisor,
  supervisorToken,
  updateScriptsRoot,
  waitForUrl,
} from "./runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let hostProcess: ChildProcess | null = null;
let supervisorProcess: ChildProcess | null = null;
let shuttingDown = false;
let logFile: string | null = null;
let bootFailed = false;
let booting = true;

function readReleaseMeta(runtime: string): { version?: string; commit?: string } {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(runtime, "release.json"), "utf8")
    ) as { version?: string; commit?: string };
  } catch {
    return {};
  }
}

function showSplash(message: string): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents
      .executeJavaScript(
        `document.getElementById("msg").textContent = ${JSON.stringify(message)}`
      )
      .catch(() => undefined);
    return;
  }
  splashWindow = new BrowserWindow({
    width: 420,
    height: 180,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: "GodMode",
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const html = `<!doctype html><html><body style="margin:0;font:15px/1.4 system-ui,Segoe UI,sans-serif;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh">
  <div style="text-align:center;padding:24px">
    <div style="font-size:20px;font-weight:600;margin-bottom:12px">GodMode</div>
    <div id="msg">${message.replaceAll("<", "&lt;")}</div>
  </div></body></html>`;
  void splashWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  );
  splashWindow.on("closed", () => {
    splashWindow = null;
  });
}

function closeSplash(): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
}

function failStartup(title: string, detail: string): void {
  bootFailed = true;
  appendLog(logFile, `${title}: ${detail}`);
  const logHint = logFile ? `\n\nDetails were written to:\n${logFile}` : "";
  dialog.showErrorBox(title, `${detail}${logHint}`);
  stopChildren();
  closeSplash();
  app.quit();
}

async function boot(): Promise<string> {
  const runtime = runtimeRoot(app.isPackaged, appRoot);
  const updateRoot = updateScriptsRoot(app.isPackaged, appRoot);
  ensureRuntimeDependencies(runtime);
  const release = readReleaseMeta(runtime);
  const [publicPort, bridgePort, supervisorPort] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
  ]);
  const token = supervisorToken();
  const publicUrl = `http://127.0.0.1:${publicPort}`;
  const dataDir = path.join(app.getPath("userData"), "data");
  const snapshotDir = path.join(app.getPath("userData"), "update-snapshots");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(snapshotDir, { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    DEPLOYMENT_MODE: "local",
    INSTALLATION_SURFACE: "electron",
    PLATFORM_DATA_DIR: dataDir,
    UPDATE_SNAPSHOT_DIR: snapshotDir,
    GODMODE_HOST: "127.0.0.1",
    GODMODE_PORT: String(publicPort),
    BRIDGE_HOST: "127.0.0.1",
    BRIDGE_PORT: String(bridgePort),
    AUTH_PUBLIC_URL: publicUrl,
    WEB_PUBLIC_URL: publicUrl,
    WEB_ORIGIN: publicUrl,
    UPDATE_SUPERVISOR_HOST: "127.0.0.1",
    UPDATE_SUPERVISOR_PORT: String(supervisorPort),
    UPDATE_SUPERVISOR_URL: `http://127.0.0.1:${supervisorPort}`,
    UPDATE_SUPERVISOR_TOKEN: token,
    UPDATE_READINESS_URL: `${publicUrl}/api/update/readiness`,
    UPDATE_WORKING_DIR: runtime,
    GODMODE_NODE_BIN: nodeBinary(runtime),
    GODMODE_DESKTOP_EXECUTABLE: process.execPath,
    UPDATE_RELEASE_REPOSITORY:
      process.env.UPDATE_RELEASE_REPOSITORY ?? "ReBoticsAI/GodMode",
  };
  if (process.env.APPIMAGE) env.APPIMAGE = process.env.APPIMAGE;
  if (release.version) env.GODMODE_VERSION = String(release.version);
  if (release.commit) env.GODMODE_COMMIT = String(release.commit);

  appendLog(
    logFile,
    `Starting host runtime=${runtime} public=${publicUrl} data=${dataDir}`
  );
  showSplash("Starting local services…");

  hostProcess = spawnHost({ runtime, env, logFile });
  hostProcess.on("exit", (code, signal) => {
    if (shuttingDown || bootFailed) return;
    failStartup(
      "GodMode failed to start",
      `The local host process exited unexpectedly (code=${code ?? "?"} signal=${signal ?? "none"}).`
    );
  });

  supervisorProcess = spawnSupervisor({ updateRoot, env, logFile });
  supervisorProcess.on("exit", (code, signal) => {
    if (shuttingDown) return;
    appendLog(
      logFile,
      `Update supervisor exited (code=${code} signal=${signal}); one-click apply unavailable`
    );
  });

  showSplash("Waiting for GodMode to become ready…");
  await waitForUrl(`${publicUrl}/api/health`);
  return publicUrl;
}

function createWindow(url: string): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "GodMode",
    webPreferences: {
      preload: path.join(appRoot, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const showMain = () => {
    booting = false;
    closeSplash();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  };
  mainWindow.once("ready-to-show", showMain);
  // Fallback if ready-to-show never fires (some Windows GPU drivers).
  setTimeout(showMain, 8_000);
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, validatedURL) => {
    failStartup(
      "GodMode failed to load",
      `Could not load ${validatedURL} (code ${code}): ${desc}`
    );
  });
  void mainWindow.loadURL(url);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function stopChildren(): void {
  shuttingDown = true;
  for (const child of [supervisorProcess, hostProcess]) {
    if (!child || child.killed) continue;
    try {
      child.kill();
    } catch {
      // ignore
    }
  }
  supervisorProcess = null;
  hostProcess = null;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      return;
    }
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    logFile = openLogFile(app.getPath("userData"));
    process.on("uncaughtException", (error) => {
      failStartup(
        "GodMode crashed",
        error instanceof Error ? error.stack ?? error.message : String(error)
      );
    });
    process.on("unhandledRejection", (reason) => {
      failStartup(
        "GodMode crashed",
        reason instanceof Error ? reason.stack ?? reason.message : String(reason)
      );
    });

    try {
      const devUrl = process.env.GODMODE_DEV_URL?.trim();
      if (devUrl) {
        createWindow(devUrl);
        return;
      }
      showSplash("Preparing GodMode…");
      const url = await boot();
      if (bootFailed) return;
      createWindow(url);
    } catch (error) {
      if (bootFailed) return;
      failStartup(
        "GodMode failed to start",
        error instanceof Error ? error.stack ?? error.message : String(error)
      );
    }
  });

  app.on("window-all-closed", () => {
    // Splash closes before the main window is shown; do not quit mid-boot.
    if (booting || bootFailed) return;
    stopChildren();
    app.quit();
  });

  app.on("before-quit", () => {
    stopChildren();
  });
}
