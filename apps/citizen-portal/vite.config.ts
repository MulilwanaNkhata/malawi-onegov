import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: { enabled: true },
      includeAssets: ["favicon-32x32.png", "apple-touch-icon.png"],
      manifest: {
        name: "Malawi OneGov",
        short_name: "OneGov",
        description: "One account. Every government service.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#f5f7f6",
        theme_color: "#074d34",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "/maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Precache the built app shell (HTML/JS/CSS/icons) so the app opens
        // even with no network -- but never the /api/* responses themselves.
        // Government application/payment status has to stay live data; a
        // stale cached copy of "your fee is unpaid" would be actively
        // misleading, so there is deliberately no runtime caching rule for
        // API calls here, only a fallback to the shell for client-side routing.
        globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
        navigateFallback: "/index.html",
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
});
