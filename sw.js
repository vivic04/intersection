// Offline support: app shell is cached on install; everything else is cached as it's fetched.
const CACHE = "intersection-v19";
const SHELL = ["./", "index.html", "app.css", "app.js", "tree.js", "manifest.webmanifest",
  "content/core.js", "content/questions.js", "content/comms.js", "content/execution.js",
  "content/negotiation.js", "content/sales.js", "content/challenges.js", "content/variants.js",
  "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "api.anthropic.com") return;
  const sameOrigin = url.origin === location.origin;
  if (sameOrigin) {
    // Network first for the app itself so updates arrive; fall back to cache offline.
    e.respondWith(fetch(req, { cache: "no-cache" }).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; }).catch(() => caches.match(req).then(r => r || caches.match("index.html"))));
  } else if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })));
  }
});

// Daily nudge
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data && e.data.text() }; }
  // Replace any earlier nudge instead of stacking (iOS doesn't always honour the tag).
  e.waitUntil(self.registration.getNotifications().then(ns => ns.forEach(n => n.close())).then(() => self.registration.showNotification(d.title || "Today's play is ready", { body: d.body || "About five minutes. Tap to start.", icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "daily", data: { url: d.url || "./" } })));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => { for (const c of cs) { if ("focus" in c) return c.focus(); } return self.clients.openWindow((e.notification.data && e.notification.data.url) || "./"); }));
});
