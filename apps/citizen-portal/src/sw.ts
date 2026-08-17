/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();
cleanupOutdatedCaches();

// Precaches the built app shell (populated by vite-plugin-pwa's
// injectManifest at build time) so the app opens with no network at all.
precacheAndRoute(self.__WB_MANIFEST);

// SPA fallback: any navigation not served from the precache falls back to
// the app shell, so client-side routes (e.g. /applications/:id) still open
// while offline -- the page's own data fetch is what then fails, surfaced
// by the offline banner, not the navigation itself.
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html")));

interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload: PushPayload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
      data: { url: payload.url ?? "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clientList) => {
      const existing = clientList.find((client): client is WindowClient => "focus" in client);
      if (existing) {
        await existing.navigate(url);
        return existing.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
