FROM node:20-alpine
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

# Build once at image-build time, not on every container start. A real
# production build (not the dev server) so the PWA's service worker
# actually precaches the built app shell -- vite-plugin-pwa's dev-mode
# worker only proves registration works, not real offline behavior. This
# container has never had a volume-mounted source (every change already
# requires an image rebuild), so switching off the dev server costs nothing.
RUN npm run build

EXPOSE 5173
CMD ["npm", "run", "preview"]
