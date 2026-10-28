const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("camvr", {
  sendPacket(packet) {
    ipcRenderer.send("tracking-packet", packet);
  },
  onDriverStatus(callback) {
    const listener = (_event, connected) => callback(connected);
    ipcRenderer.on("driver-status", listener);
    return () => ipcRenderer.removeListener("driver-status", listener);
  }
});
