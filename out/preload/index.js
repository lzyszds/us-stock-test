"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronBridge", {
  // ==================== 认证相关 ====================
  login: (params) => {
    return electron.ipcRenderer.invoke("auth:login", params);
  },
  getToken: () => {
    return electron.ipcRenderer.invoke("auth:getToken");
  },
  isLoggedIn: () => {
    return electron.ipcRenderer.invoke("auth:isLoggedIn");
  },
  getAuthInfo: () => {
    return electron.ipcRenderer.invoke("auth:getInfo");
  },
  logout: () => {
    electron.ipcRenderer.send("auth:logout");
  },
  // ==================== WebSocket 相关 ====================
  wsConnect: (url) => {
    electron.ipcRenderer.send("ws:connect", url);
  },
  wsDisconnect: () => {
    electron.ipcRenderer.send("ws:disconnect");
  },
  wsSend: (data) => {
    electron.ipcRenderer.send("ws:send", data);
  },
  wsGetStatus: () => {
    return electron.ipcRenderer.invoke("ws:getStatus");
  },
  onWsMessage: (callback) => {
    const handler = (_event, data) => callback(data);
    electron.ipcRenderer.on("ws:message", handler);
    return () => electron.ipcRenderer.removeListener("ws:message", handler);
  },
  onWsBatch: (callback) => {
    const handler = (_event, data) => callback(data);
    electron.ipcRenderer.on("ws:batch", handler);
    return () => electron.ipcRenderer.removeListener("ws:batch", handler);
  },
  onWsStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    electron.ipcRenderer.on("ws:status", handler);
    return () => electron.ipcRenderer.removeListener("ws:status", handler);
  },
  // ==================== 私有 WebSocket 相关 ====================
  wsPrivateConnect: (subscriptions) => {
    electron.ipcRenderer.send("ws-private:connect", subscriptions);
  },
  wsPrivateDisconnect: () => {
    electron.ipcRenderer.send("ws-private:disconnect");
  },
  wsPrivateSend: (data) => {
    electron.ipcRenderer.send("ws-private:send", data);
  },
  wsPrivateGetStatus: () => {
    return electron.ipcRenderer.invoke("ws-private:getStatus");
  },
  onWsPrivateMessage: (callback) => {
    const handler = (_event, data) => callback(data);
    electron.ipcRenderer.on("ws-private:message", handler);
    return () => electron.ipcRenderer.removeListener("ws-private:message", handler);
  },
  onWsPrivateStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    electron.ipcRenderer.on("ws-private:status", handler);
    return () => electron.ipcRenderer.removeListener("ws-private:status", handler);
  },
  // ==================== 应用配置 ====================
  getConfig: () => {
    return electron.ipcRenderer.invoke("config:get");
  },
  setConfig: (patch) => {
    return electron.ipcRenderer.invoke("config:set", patch);
  },
  onConfigChanged: (callback) => {
    const handler = (_event, cfg) => callback(cfg);
    electron.ipcRenderer.on("config:changed", handler);
    return () => electron.ipcRenderer.removeListener("config:changed", handler);
  },
  // ==================== Mock 行情模拟 ====================
  mockStart: () => {
    electron.ipcRenderer.send("mock:start");
  },
  mockStop: () => {
    electron.ipcRenderer.send("mock:stop");
  },
  mockIsRunning: () => {
    return electron.ipcRenderer.invoke("mock:isRunning");
  },
  onMockStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    electron.ipcRenderer.on("mock:status", handler);
    return () => electron.ipcRenderer.removeListener("mock:status", handler);
  },
  // ==================== WebView DevTools ====================
  toggleWebviewDevTools: () => {
    electron.ipcRenderer.send("webview:toggleDevTools");
  },
  isWebviewDevToolsOpened: () => {
    return electron.ipcRenderer.invoke("webview:isDevToolsOpened");
  },
  // webview preload 脚本路径（供 <webview preload> 使用）
  getWebviewPreloadPath: () => {
    return electron.ipcRenderer.invoke("webview:getPreloadPath");
  }
});
