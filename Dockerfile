# Browser-worker container. Uses the OFFICIAL Playwright image so Chromium +
# all its system deps are already present (no apt reinventing) and Node matches
# the Playwright build. Single stage: install, build, run. better-sqlite3 is a
# prebuilt native module — it resolves for this image's Node with no toolchain
# fuss. The worker boots WITHOUT any secrets (OPENROUTER_API_KEY/API_TOKEN are
# optional) so the Fly health check on /health passes on the FIRST deploy,
# before secrets are staged.
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app
ENV NODE_ENV=production PORT=8080

# Install deps first for layer caching. Need dev deps (typescript) to build.
COPY package.json package-lock.json* ./
RUN npm ci --include=dev

# Build the TS, then drop dev deps to slim the image.
COPY tsconfig.json ./
COPY src ./src
COPY manifest.json ./manifest.json
RUN npm run build && npm prune --omit=dev

# Durable state (macros + tasks) lives on a mounted volume at /app/data.
RUN mkdir -p /app/data
ENV MACRO_DB=/app/data/worker.sqlite TASKS_DB=/app/data/tasks.sqlite

EXPOSE 8080
CMD ["node", "dist/index.js"]
