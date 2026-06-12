"use strict";
const electron = require("electron");
const handlers = /* @__PURE__ */ new Map();
const noop = () => {
};
const WebViewJSBridge = {
  registerHandler(name, handler) {
    console.log("[WebViewJSBridge] registerHandler:", name);
    handlers.set(name, handler);
  },
  unregisterHandler(name) {
    console.log("[WebViewJSBridge] unregisterHandler:", name);
    handlers.delete(name);
  },
  callHandler(name, payload) {
    if (name === "startWs") {
      console.log("[WebViewJSBridge] startWs called, payload:", JSON.stringify(payload?.data));
      const req = payload?.data;
      electron.ipcRenderer.send("ws-private:connect", req?.subscriptions);
      payload?.success?.();
      return void 0;
    }
    if (name === "kbPrivate") {
      electron.ipcRenderer.send("ws-private:send", payload?.data);
      return void 0;
    }
    if (name === "stopWs") {
      electron.ipcRenderer.send("ws-private:disconnect");
      payload?.success?.();
      return void 0;
    }
    if (name === "usStockPublic") {
      electron.ipcRenderer.send("ws:send", payload?.data);
      return void 0;
    }
    if (name === "proxy") {
      const req = payload?.data;
      const proxyUrl = (req.url || "").replace("https://stock.xueqiu.com", "/xueqiu-api").replace("https://api.xueqiu.com", "/api.xueqiu");
      const method = (req.method || "GET").toUpperCase();
      const qs = new URLSearchParams();
      if (req.params) {
        for (const [k, v] of Object.entries(req.params)) {
          if (v !== void 0 && v !== null) qs.append(k, String(v));
        }
      }
      let finalUrl = proxyUrl;
      const opts = { method, credentials: "include" };
      if (method === "GET" || method === "HEAD") {
        if ([...qs].length) finalUrl += (proxyUrl.includes("?") ? "&" : "?") + qs.toString();
      } else if ([...qs].length) {
        opts.body = qs.toString();
        opts.headers = { "Content-Type": "application/x-www-form-urlencoded" };
      }
      const p = fetch(finalUrl, opts).then((r) => r.json());
      p.then((d) => payload?.success?.(d)).catch((e) => payload?.fail?.(String(e)));
      return p;
    }
    if (name === "getAuth") {
      const p = electron.ipcRenderer.invoke("auth:getTokens");
      p.then((d) => payload?.success?.(d)).catch((e) => payload?.fail?.(String(e)));
      return p;
    }
    console.warn("[WebViewJSBridge] 未实现的 callHandler:", name, payload);
    return void 0;
  }
};
electron.contextBridge.exposeInMainWorld("WebViewJSBridge", WebViewJSBridge);
electron.ipcRenderer.on("ws-data", (_e, msg) => {
  const handler = handlers.get("kbPublicMessage");
  if (handler) {
    handler(msg, noop, noop);
  }
});
electron.ipcRenderer.on("ws-private-data", (_e, msg) => {
  const handler = handlers.get("kbPrivateMessage");
  if (handler) {
    handler(msg, noop, noop);
  }
});
