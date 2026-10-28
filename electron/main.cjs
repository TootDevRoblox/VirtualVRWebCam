const { app, BrowserWindow, ipcMain, session } = require("electron");
const dgram = require("node:dgram");
const path = require("node:path");

let mainWindow;
let driverConnected = false;
const bridge = dgram.createSocket("udp4");

function publishDriverStatus(connected) {
  if (driverConnected === connected) {
    return;
  }

  driverConnected = connected;
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("driver-status", connected);
  }
}

bridge.on("message", (message) => {
  if (message.toString() === "CAMVR:READY") {
    publishDriverStatus(true);
    clearTimeout(bridge.statusTimeout);
    bridge.statusTimeout = setTimeout(() => publishDriverStatus(false), 1500);
  }
});

bridge.on("error", (error) => {
  console.error("Falha na ponte UDP do driver:", error);
  publishDriverStatus(false);
});

ipcMain.on("tracking-packet", (_event, packet) => {
  if (typeof packet !== "string" || packet.length > 512) {
    return;
  }

  bridge.send(packet, 26760, "127.0.0.1", (error) => {
    if (error) {
      console.error("Falha ao enviar rastreamento ao driver:", error);
    }
  });
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#0a0d12",
    title: "CamVR",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  mainWindow.loadURL("http://127.0.0.1:5173");
}

app.whenReady().then(() => {
  const isCamVrOrigin = (origin) => origin === "http://127.0.0.1:5173";

  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    return permission === "media" &&
      details.mediaType === "video" &&
      details.isMainFrame &&
      isCamVrOrigin(requestingOrigin);
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    callback(
      permission === "media" &&
      details.isMainFrame &&
      details.requestingUrl.startsWith("http://127.0.0.1:5173/") &&
      details.mediaTypes?.includes("video") === true
    );
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  clearTimeout(bridge.statusTimeout);
  bridge.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
