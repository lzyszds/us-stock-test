"use strict";
const electron = require("electron");
const path = require("path");
const utils = require("@electron-toolkit/utils");
const crypto = require("crypto");
const httpsProxyAgent = require("https-proxy-agent");
const axios = require("axios");
const uuid = require("uuid");
const nodeMachineId = require("node-machine-id");
const fs = require("fs");
const WebSocket = require("ws");
const icon = path.join(__dirname, "../../resources/icon.png");
const DEFAULT_CONFIG = {
  webviewUrl: "https://test.qqlink.info/zh-hans/financial/usStocks?safeArea=50&vconsole=yes",
  wsUrl: "wss://ws.keepbit.com/v2/ws/public",
  wsPrivateUrl: "wss://ws.keepbit.com/v2/ws/private",
  wsApiKey: "kbappSys",
  apiBaseUrl: "https://chat.qqlink.io/chat",
  throttle: {
    enabled: true,
    intervalMs: 500
  },
  mock: {
    intervalMs: 500,
    batchSize: 120
  }
};
let configPath = "";
let cached = null;
function getPath() {
  if (!configPath) {
    configPath = path.join(electron.app.getPath("userData"), "app-config.json");
  }
  return configPath;
}
function merge(base, patch) {
  return {
    webviewUrl: patch.webviewUrl ?? base.webviewUrl,
    wsUrl: patch.wsUrl ?? base.wsUrl,
    wsPrivateUrl: patch.wsPrivateUrl ?? base.wsPrivateUrl,
    wsApiKey: patch.wsApiKey ?? base.wsApiKey,
    apiBaseUrl: patch.apiBaseUrl ?? base.apiBaseUrl,
    throttle: { ...base.throttle, ...patch.throttle },
    mock: { ...base.mock, ...patch.mock }
  };
}
function loadConfig() {
  if (cached) return cached;
  try {
    if (fs.existsSync(getPath())) {
      const raw = JSON.parse(fs.readFileSync(getPath(), "utf-8"));
      cached = merge(DEFAULT_CONFIG, raw);
    } else {
      cached = { ...DEFAULT_CONFIG };
    }
  } catch (e) {
    console.error("[Config] 读取失败，使用默认配置:", e);
    cached = { ...DEFAULT_CONFIG };
  }
  return cached;
}
function saveConfig(patch) {
  cached = merge(loadConfig(), patch);
  try {
    fs.writeFileSync(getPath(), JSON.stringify(cached, null, 2), "utf-8");
  } catch (e) {
    console.error("[Config] 保存失败:", e);
  }
  return cached;
}
const PROXY_URL = "http://127.0.0.1:7890";
const proxyAgent = new httpsProxyAgent.HttpsProxyAgent(PROXY_URL);
let cachedMachineId = "";
function getMachineId() {
  if (!cachedMachineId) {
    try {
      cachedMachineId = nodeMachineId.machineIdSync();
    } catch {
      cachedMachineId = "unknown-device-id";
    }
  }
  return cachedMachineId;
}
function getDeviceInfo() {
  return {
    deviceId: getMachineId(),
    deviceName: "Electron Desktop"
  };
}
const requestSkipToken = axios.create({
  // baseURL 在请求拦截器里按配置动态注入（支持运行时改服务器地址）
  timeout: 15e3,
  httpsAgent: proxyAgent,
  httpAgent: proxyAgent,
  proxy: false
  // 禁用 axios 内置 proxy，使用自定义 agent
});
requestSkipToken.interceptors.request.use((config) => {
  config.baseURL = loadConfig().apiBaseUrl;
  config.headers = config.headers ?? {};
  config.headers["operationID"] = uuid.v4();
  const platform = 2;
  config.headers["Version"] = `${platform}-${electron.app.getVersion()}`;
  config.headers["Terminal-Version"] = electron.app.getVersion();
  config.headers["AppType"] = "QQLink";
  config.headers["DeviceId"] = getMachineId();
  config.headers["Accept-Language"] = "zh-CN";
  config.httpsAgent = proxyAgent;
  config.httpAgent = proxyAgent;
  return config;
});
requestSkipToken.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error("[API] 请求失败:", error?.response?.data || error.message);
    return Promise.reject(error);
  }
);
function getAreaCode(areaCode) {
  if (!areaCode) return "+86";
  return areaCode.startsWith("+") ? areaCode : `+${areaCode}`;
}
async function login(params) {
  const deviceInfo = getDeviceInfo();
  const platform = 2;
  const { data } = await requestSkipToken.post("/account/login", {
    ...params,
    password: crypto.createHash("md5").update(params.password).digest("hex"),
    platform,
    areaCode: getAreaCode(params.areaCode),
    version: electron.app.getVersion(),
    deviceID: deviceInfo.deviceId,
    deviceType: encodeURIComponent(deviceInfo.deviceName)
  });
  return data;
}
const defaults = {
  token: "",
  refreshToken: "",
  expireTime: 0,
  userID: "",
  loginTime: "",
  walletToken: "",
  secretKey: "",
  kbitToken: "",
  chatToken: ""
};
function getStorePath() {
  const dir = path.join(electron.app.getPath("userData"), "auth");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, "auth.json");
}
function loadStore() {
  try {
    const path2 = getStorePath();
    if (fs.existsSync(path2)) {
      return JSON.parse(fs.readFileSync(path2, "utf-8"));
    }
  } catch (e) {
    console.error("[Auth] 读取存储失败:", e);
  }
  return { ...defaults };
}
function saveStore(data) {
  try {
    fs.writeFileSync(getStorePath(), JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error("[Auth] 写入存储失败:", e);
  }
}
function saveToken(data) {
  const store = loadStore();
  store.token = data.token;
  store.refreshToken = data.refreshToken;
  store.expireTime = data.expireTime;
  store.userID = data.userID;
  store.loginTime = (/* @__PURE__ */ new Date()).toISOString();
  store.walletToken = data.walletToken ?? "";
  store.secretKey = data.secretKey ?? "";
  store.kbitToken = data.kbitToken ?? "";
  store.chatToken = data.chatToken ?? data.token ?? "";
  saveStore(store);
}
function getAuthTokens() {
  const store = loadStore();
  return {
    token: store.walletToken,
    // token 字段 = walletToken
    secretKey: store.secretKey,
    kbitToken: store.kbitToken,
    chatToken: store.chatToken
  };
}
function getToken() {
  return loadStore().token;
}
function isTokenValid() {
  const store = loadStore();
  return !!store.token && Date.now() / 1e3 < store.expireTime;
}
function clearToken() {
  saveStore({ ...defaults });
}
function getAuthInfo() {
  return loadStore();
}
const PING_CMD$1 = "ping";
const HEARTBEAT_INTERVAL$1 = 3e4;
function isHeartbeatMessage(message) {
  const t = message.trim();
  return t === "pong" || t === "ping";
}
function debugLog$1(msg) {
  const line = `[${(/* @__PURE__ */ new Date()).toISOString()}] ${msg}
`;
  try {
    fs.appendFileSync("/tmp/ws-private-debug.log", line);
  } catch {
  }
  console.log(msg);
}
const PING_CMD = "ping";
const HEARTBEAT_INTERVAL = 3e4;
function buildSign(timestamp, secretKey) {
  const prehash = timestamp + "GET/user/verify";
  return crypto.createHmac("sha256", secretKey).update(prehash).digest("base64");
}
function buildLoginCmd(args) {
  const timestamp = Date.now().toString();
  const sign = buildSign(timestamp, args.secretKey);
  const cmd = {
    op: "login",
    args: [
      {
        apiKey: args.apiKey,
        passphrase: args.passphrase,
        clientType: args.clientType,
        timestamp,
        sign
      }
    ]
  };
  debugLog$1("[WS-Private] login 命令: " + JSON.stringify({
    ...cmd,
    args: cmd.args.map((a) => ({ ...a, passphrase: a.passphrase.slice(0, 20) + "...", sign: a.sign.slice(0, 10) + "..." }))
  }));
  return JSON.stringify(cmd);
}
function buildSubscribeCmd(items) {
  return JSON.stringify({
    op: "subscribe",
    args: items
  });
}
function isHeartbeat(msg) {
  const t = msg.trim();
  return t === "pong" || t === "ping";
}
class PrivateWsClient {
  constructor(loginArgs) {
    this.loginArgs = loginArgs;
  }
  loginArgs;
  ws = null;
  heartbeatTimer = null;
  pendingSubs = [];
  loggedIn = false;
  url = "";
  // 外部回调
  onData = () => {
  };
  onStatus = () => {
  };
  setOnData(cb) {
    this.onData = cb;
  }
  setOnStatus(cb) {
    this.onStatus = cb;
  }
  get connected() {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
  get isLoggedIn() {
    return this.loggedIn;
  }
  connect(url, subscriptions2) {
    this.url = url;
    this.loggedIn = false;
    if (subscriptions2) {
      this.pendingSubs = subscriptions2;
    }
    if (this.ws) {
      this.ws.terminate();
    }
    this.ws = new WebSocket(url, { rejectUnauthorized: false });
    this.ws.on("open", () => {
      debugLog$1(`[WS-Private] 已连接到 ${url}，发送 login`);
      this.emitStatus();
      this.ws.send(buildLoginCmd(this.loginArgs));
    });
    this.ws.on("message", (raw) => {
      const text = raw.toString();
      if (isHeartbeat(text)) return;
      try {
        const parsed = JSON.parse(text);
        this.handleMessage(parsed);
      } catch (e) {
        debugLog$1(`[WS-Private] 解析消息失败: ${e}`);
      }
    });
    this.ws.on("close", () => {
      this.loggedIn = false;
      this.stopHeartbeat();
      debugLog$1("[WS-Private] 连接已关闭");
      this.emitStatus();
    });
    this.ws.on("error", (err) => {
      this.loggedIn = false;
      this.stopHeartbeat();
      debugLog$1(`[WS-Private] 连接错误: ${err.message}`);
      this.onStatus({ connected: false, loggedIn: false, url: this.url, error: err.message });
    });
  }
  disconnect() {
    this.stopHeartbeat();
    this.loggedIn = false;
    if (this.ws) {
      this.ws.terminate();
      this.ws = null;
    }
    this.emitStatus();
  }
  send(data) {
    const text = typeof data === "string" ? data : JSON.stringify(data);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(text);
    } else {
      debugLog$1(`[WS-Private] 未就绪，丢弃: ${text}`);
    }
  }
  subscribe(items) {
    if (this.loggedIn && this.connected) {
      this.ws.send(buildSubscribeCmd(items));
    } else {
      this.pendingSubs.push(...items);
    }
  }
  handleMessage(parsed) {
    if ("event" in parsed) {
      const event = parsed.event;
      const code = parsed.code;
      if (event === "login") {
        if (code === "0") {
          debugLog$1("[WS-Private] 登录成功");
          this.loggedIn = true;
          this.emitStatus();
          this.startHeartbeat();
          this.flushPendingSubs();
        } else {
          debugLog$1(`[WS-Private] 登录失败: code=${code} msg=${parsed.msg}`);
          this.emitStatus();
        }
        return;
      }
      if (event === "subscribe" || event === "unsubscribe") {
        debugLog$1(`[WS-Private] ${event} ACK: ${JSON.stringify(parsed.arg)}`);
        this.onData(parsed);
        return;
      }
      if (event === "error") {
        debugLog$1(`[WS-Private] 错误: code=${code} msg=${parsed.msg}`);
        this.onData(parsed);
        return;
      }
    }
    if ("action" in parsed) {
      this.onData(parsed);
      return;
    }
    debugLog$1(`[WS-Private] 未知消息: ${JSON.stringify(parsed)}`);
  }
  flushPendingSubs() {
    if (this.pendingSubs.length === 0) return;
    const items = this.pendingSubs.splice(0);
    this.ws.send(buildSubscribeCmd(items));
    debugLog$1(`[WS-Private] 补发缓存订阅: ${items.length} 个`);
  }
  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.connected) {
        this.ws.send(PING_CMD);
      }
    }, HEARTBEAT_INTERVAL);
  }
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  emitStatus() {
    this.onStatus({
      connected: this.connected,
      loggedIn: this.loggedIn,
      url: this.url
    });
  }
}
function rand(min, max) {
  return Math.random() * (max - min) + min;
}
function fmt(n, decimals = 2) {
  return n.toFixed(decimals);
}
function buildMessage(state, instType, channel) {
  const drift = state.last * rand(-25e-4, 25e-4);
  state.last = Math.max(0.01, state.last + drift);
  state.high = Math.max(state.high, state.last);
  state.low = Math.min(state.low, state.last);
  const spread = state.last * 2e-4;
  const bidPrice = state.last - spread;
  const askPrice = state.last + spread;
  const change = state.last - state.prevClose;
  const changePercent = change / state.prevClose * 100;
  return {
    action: "update",
    arg: { instType, channel, instId: state.symbol },
    data: [
      {
        symbol: state.symbol,
        bidPrice: fmt(bidPrice),
        bidSize: String(Math.round(rand(100, 2e4) / 100) * 100),
        askPrice: fmt(askPrice),
        askSize: String(Math.round(rand(100, 2e4) / 100) * 100),
        lastPrice: fmt(state.last),
        ts: String(Date.now()),
        prevClose: fmt(state.prevClose),
        change: fmt(change),
        changePercent: fmt(changePercent, 5),
        open: fmt(state.open),
        high: fmt(state.high),
        low: fmt(state.low)
      }
    ]
  };
}
function startMockWs(onMessage, options) {
  const { getSubscriptions, intervalMs = 500, batchSize = 120 } = options;
  const states = /* @__PURE__ */ new Map();
  function ensureState(instId) {
    let s = states.get(instId);
    if (!s) {
      const prevClose = rand(50, 500);
      const open = prevClose * rand(0.99, 1.01);
      s = { symbol: instId, prevClose, last: open, open, high: open, low: open };
      states.set(instId, s);
    }
    return s;
  }
  console.log(`[MockWS] 启动：每 ${intervalMs}ms 推 ${batchSize} 条，跟随订阅动态模拟`);
  const timer = setInterval(() => {
    const subs = getSubscriptions().filter((s) => s.channel === "ticker");
    if (subs.length === 0) return;
    const active = new Set(subs.map((s) => s.instId));
    for (const id of states.keys()) {
      if (!active.has(id)) states.delete(id);
    }
    for (let i = 0; i < batchSize; i++) {
      const sub = subs[Math.floor(Math.random() * subs.length)];
      const state = ensureState(sub.instId);
      onMessage(buildMessage(state, sub.instType, sub.channel));
    }
  }, intervalMs);
  return () => {
    clearInterval(timer);
    console.log("[MockWS] 已停止模拟推送");
  };
}
function debugLog(msg) {
  const line = `[${(/* @__PURE__ */ new Date()).toISOString()}] ${msg}
`;
  try {
    fs.appendFileSync("/tmp/ws-private-debug.log", line);
  } catch {
  }
  console.log(msg);
}
let mainWindow = null;
let wsClient = null;
let wsUrl = "";
let wsConnected = false;
let heartbeatTimer = null;
const pendingSends = [];
const subscriptions = /* @__PURE__ */ new Map();
function trackSubscription(text) {
  try {
    const cmd = JSON.parse(text);
    if (!cmd || !Array.isArray(cmd.args)) return;
    if (cmd.op !== "subscribe" && cmd.op !== "unsubscribe") return;
    for (const a of cmd.args) {
      if (!a?.instId || !a?.channel) continue;
      const key = `${a.channel}:${a.instId}`;
      if (cmd.op === "subscribe") {
        subscriptions.set(key, { instType: a.instType, channel: a.channel, instId: a.instId });
        console.log("[Sub] 订阅:", key);
      } else {
        subscriptions.delete(key);
        console.log("[Sub] 退订:", key);
      }
    }
  } catch {
  }
}
function wsSendRaw(data) {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  trackSubscription(text);
  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    wsClient.send(text);
  } else {
    pendingSends.push(text);
    console.log(`[WS] 未就绪，缓存待发:`, text);
  }
}
function flushPendingSends() {
  if (!wsClient || wsClient.readyState !== WebSocket.OPEN) return;
  while (pendingSends.length) {
    const text = pendingSends.shift();
    wsClient.send(text);
    console.log(`[WS] 补发缓存订阅:`, text);
  }
}
function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
      wsClient.send(PING_CMD$1);
    }
  }, HEARTBEAT_INTERVAL$1);
}
function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
const tickerUpdateDataMap = /* @__PURE__ */ new Map();
const throttleBuffer = /* @__PURE__ */ new Map();
let throttleTimer = null;
function startThrottle() {
  stopThrottle();
  const cfg = loadConfig().throttle;
  if (!cfg.enabled) return;
  throttleTimer = setInterval(() => {
    if (throttleBuffer.size === 0) return;
    const batch = Array.from(throttleBuffer.values());
    throttleBuffer.clear();
    sendToRenderer("ws:batch", batch);
  }, cfg.intervalMs);
}
function stopThrottle() {
  if (throttleTimer) {
    clearInterval(throttleTimer);
    throttleTimer = null;
  }
  throttleBuffer.clear();
}
function handleParsed(parsed) {
  tickerUpdateDataMap.set(parsed.arg.instId, parsed);
  forwardToWebView(parsed);
  if (loadConfig().throttle.enabled) {
    throttleBuffer.set(parsed.arg.instId, parsed);
  } else {
    sendToRenderer("ws:message", parsed);
  }
}
function connectWebSocket(url) {
  wsUrl = url;
  if (wsClient) {
    wsClient.terminate();
  }
  wsClient = new WebSocket(url, {
    rejectUnauthorized: false
  });
  wsClient.on("open", () => {
    wsConnected = true;
    console.log(`[WS] 已连接到 ${url}`);
    sendToRenderer("ws:status", { connected: true, url });
    flushPendingSends();
    startHeartbeat();
  });
  wsClient.on("message", (data) => {
    const raw = data.toString();
    if (isHeartbeatMessage(raw)) return;
    try {
      const parsed = JSON.parse(raw);
      console.log(`[WS] 收到消息:`, parsed);
      handleParsed(parsed);
    } catch (e) {
      console.error(`[WS] 解析消息失败:`, e);
    }
  });
  wsClient.on("close", () => {
    wsConnected = false;
    stopHeartbeat();
    console.log(`[WS] 连接已关闭`);
    sendToRenderer("ws:status", { connected: false, url });
  });
  wsClient.on("error", (err) => {
    wsConnected = false;
    stopHeartbeat();
    console.error(`[WS] 连接错误:`, err.message);
    sendToRenderer("ws:status", { connected: false, url, error: err.message });
  });
}
function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}
function forwardToWebView(data) {
  for (const wc of electron.webContents.getAllWebContents()) {
    if (wc !== mainWindow?.webContents && !wc.isDestroyed()) {
      wc.send("ws-data", data);
    }
  }
}
let privateWsClient = null;
function connectPrivateWs(subscriptions2) {
  const cfg = loadConfig();
  const auth = getAuthInfo();
  debugLog("[WS-Private] connectPrivateWs 被调用");
  debugLog(`[WS-Private] wsPrivateUrl: ${cfg.wsPrivateUrl}`);
  debugLog(`[WS-Private] wsApiKey: ${cfg.wsApiKey}`);
  debugLog(`[WS-Private] kbitToken: ${auth.kbitToken ? auth.kbitToken.slice(0, 20) + "..." : "(空)"}`);
  debugLog(`[WS-Private] secretKey: ${auth.secretKey ? auth.secretKey.slice(0, 8) + "..." : "(空)"}`);
  debugLog(`[WS-Private] subscriptions: ${JSON.stringify(subscriptions2)}`);
  if (!auth.kbitToken) {
    console.error("[WS-Private] 无法连接：缺少 kbitToken，请先登录");
    return;
  }
  if (!auth.secretKey) {
    console.error("[WS-Private] 无法连接：缺少签名密钥 secretKey，请先登录");
    return;
  }
  if (privateWsClient) {
    privateWsClient.disconnect();
  }
  privateWsClient = new PrivateWsClient({
    apiKey: cfg.wsApiKey,
    secretKey: auth.secretKey,
    passphrase: auth.kbitToken,
    clientType: "ios"
  });
  privateWsClient.setOnData((data) => {
    debugLog(`[WS-Private] 推送: ${JSON.stringify(data)}`);
    forwardPrivateToWebView(data);
    sendToRenderer("ws-private:message", data);
  });
  privateWsClient.setOnStatus((status) => {
    debugLog(`[WS-Private] 状态: ${JSON.stringify(status)}`);
    sendToRenderer("ws-private:status", status);
  });
  privateWsClient.connect(cfg.wsPrivateUrl, subscriptions2);
}
function forwardPrivateToWebView(data) {
  for (const wc of electron.webContents.getAllWebContents()) {
    if (wc !== mainWindow?.webContents && !wc.isDestroyed()) {
      wc.send("ws-private-data", data);
    }
  }
}
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    ...process.platform === "linux" ? { icon } : {},
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      webviewTag: true
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}
electron.ipcMain.handle(
  "auth:login",
  async (_event, params) => {
    try {
      const result = await login(params);
      if (result.errCode === 0 && result.data) {
        saveToken({
          token: result.data.token,
          refreshToken: result.data.refreshToken,
          expireTime: result.data.expireTime,
          userID: result.data.userID,
          walletToken: result.data.walletToken,
          secretKey: result.data.secretKey,
          kbitToken: result.data.kbitToken,
          chatToken: result.data.chatToken
        });
        console.log(`[Auth] 登录成功, userID: ${result.data.userID}`);
        return { success: true, data: result.data };
      } else {
        console.error(`[Auth] 登录失败: ${result.errMsg}`);
        return { success: false, errMsg: result.errMsg, errCode: result.errCode };
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "登录请求失败";
      console.error(`[Auth] 登录异常:`, errMsg);
      return { success: false, errMsg };
    }
  }
);
electron.ipcMain.handle("auth:getToken", () => {
  return getToken();
});
electron.ipcMain.handle("auth:isLoggedIn", () => {
  return isTokenValid();
});
electron.ipcMain.handle("auth:getInfo", () => {
  return getAuthInfo();
});
electron.ipcMain.handle("auth:getTokens", () => {
  return getAuthTokens();
});
electron.ipcMain.on("auth:logout", () => {
  clearToken();
  console.log(`[Auth] 已退出登录`);
});
electron.ipcMain.on("ws:connect", (_event, url) => {
  connectWebSocket(url);
});
electron.ipcMain.on("ws:disconnect", () => {
  if (wsClient) {
    stopHeartbeat();
    wsClient.terminate();
    wsClient = null;
    wsConnected = false;
    sendToRenderer("ws:status", { connected: false, url: wsUrl });
  }
});
electron.ipcMain.on("ws:send", (_event, data) => {
  wsSendRaw(data);
});
electron.ipcMain.on("ws-private:connect", (_event, subscriptions2) => {
  connectPrivateWs(subscriptions2);
});
electron.ipcMain.on("ws-private:disconnect", () => {
  if (privateWsClient) {
    privateWsClient.disconnect();
    privateWsClient = null;
  }
});
electron.ipcMain.on("ws-private:send", (_event, data) => {
  if (privateWsClient) {
    privateWsClient.send(data);
  }
});
electron.ipcMain.on("ws-private:subscribe", (_event, items) => {
  if (privateWsClient) {
    privateWsClient.subscribe(items);
  }
});
electron.ipcMain.handle("ws-private:getStatus", () => {
  return {
    connected: privateWsClient?.connected ?? false,
    loggedIn: privateWsClient?.isLoggedIn ?? false
  };
});
let stopMock = null;
function launchMock() {
  const m = loadConfig().mock;
  return startMockWs(handleParsed, {
    intervalMs: m.intervalMs,
    batchSize: m.batchSize,
    // 模拟的标的完全跟随 webview 当前订阅
    getSubscriptions: () => Array.from(subscriptions.values())
  });
}
electron.ipcMain.on("mock:start", () => {
  if (stopMock) return;
  stopMock = launchMock();
  sendToRenderer("mock:status", { running: true });
});
electron.ipcMain.on("mock:stop", () => {
  if (stopMock) {
    stopMock();
    stopMock = null;
  }
  sendToRenderer("mock:status", { running: false });
});
electron.ipcMain.handle("mock:isRunning", () => stopMock !== null);
electron.ipcMain.handle("config:get", () => loadConfig());
electron.ipcMain.handle("config:set", (_event, patch) => {
  const next = saveConfig(patch);
  startThrottle();
  if (stopMock) {
    stopMock();
    stopMock = launchMock();
  }
  sendToRenderer("config:changed", next);
  return next;
});
electron.ipcMain.handle("ws:getStatus", () => {
  return {
    connected: wsConnected,
    url: wsUrl
  };
});
electron.ipcMain.handle("webview:getPreloadPath", () => {
  return `file://${path.join(__dirname, "../preload/webview.js")}`;
});
electron.ipcMain.on("webview:toggleDevTools", () => {
  for (const wc of electron.webContents.getAllWebContents()) {
    if (wc !== mainWindow?.webContents && !wc.isDestroyed()) {
      if (wc.isDevToolsOpened()) {
        wc.closeDevTools();
      } else {
        wc.openDevTools({ mode: "detach" });
      }
    }
  }
});
electron.ipcMain.handle("webview:isDevToolsOpened", () => {
  for (const wc of electron.webContents.getAllWebContents()) {
    if (wc !== mainWindow?.webContents && !wc.isDestroyed()) {
      return wc.isDevToolsOpened();
    }
  }
  return false;
});
electron.app.whenReady().then(() => {
  utils.electronApp.setAppUserModelId("com.electron");
  electron.app.on("browser-window-created", (_, window) => {
    utils.optimizer.watchWindowShortcuts(window);
  });
  createWindow();
  startThrottle();
  electron.app.on("activate", function() {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (wsClient) wsClient.terminate();
  if (privateWsClient) privateWsClient.disconnect();
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
