import {
  app,
  BrowserWindow,
  dialog,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";
import {
  freePort,
  runtimeRoot,
  spawnHost,
  spawnSupervisor,
  supervisorToken,
  updateScriptsRoot,
  waitForUrl,
  nodeBinary,
} from "./runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

let mainWindow: BrowserWindow | null = null;
let hostProcess: ChildProcess | null = null;
let supervisorProcess: ChildProcess | null = null;
let shuttingDown = false;

function readReleaseMeta(runtime: string): { version?: string; commit?: string } {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(runtime, "release.json"), "utf8")
    ) as { version?: string; commit?: string };
  } catch {
    return {};
  }
}

async function boot(): Promise<string> {
  const runtime = runtimeRoot(app.isPackaged, appRoot);
  const updateRoot = updateScriptsRoot(app.isPackaged, appRoot);
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

  hostProcess = spawnHost({ runtime, env });
  hostProcess.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`GodMode host exited (code=${code} signal=${signal})`);
    app.quit();
  });

  supervisorProcess = spawnSupervisor({ updateRoot, env });
  supervisorProcess.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.warn(
      `Update supervisor exited (code=${code} signal=${signal}); one-click apply unavailable`
    );
  });

  await waitForUrl(`${publicUrl}/api/health`).catch(async () => {
    // health may be unauthenticated or named differently — fall back to root
    await waitForUrl(publicUrl);
  });

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
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
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
      if (process.platform === "win32") {
        child.kill();
      } else {
        child.kill("SIGTERM");
      }
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
    }
  });

  app.whenReady().then(async () => {
    try {
      const devUrl = process.env.GODMODE_DEV_URL?.trim();
      const url = devUrl || (await boot());
      createWindow(url);
    } catch (error) {
      dialog.showErrorBox(
        "GodMode failed to start",
        error instanceof Error ? error.message : String(error)
      );
      stopChildren();
      app.quit();
    }
  });

  app.on("window-all-closed", () => {
    stopChildren();
    app.quit();
  });

  app.on("before-quit", () => {
    stopChildren();
  });
}
