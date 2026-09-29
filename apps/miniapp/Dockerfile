FROM node:22.22-alpine AS dependencies
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
ARG VITE_API_BASE_URL=http://localhost:3000
ARG VITE_DEMO_MODE=false
ARG VITE_MAX_BOT_USERNAME=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_DEMO_MODE=$VITE_DEMO_MODE
ENV VITE_MAX_BOT_USERNAME=$VITE_MAX_BOT_USERNAME
COPY tsconfig.json ./
COPY apps/miniapp ./apps/miniapp
COPY packages/i18n/src/base-overlays.ts ./packages/i18n/src/base-overlays.ts
RUN pnpm build:miniapp

FROM node:22.22-alpine AS runtime
ENV PORT=4173
WORKDIR /app
COPY --from=build /app/apps/miniapp/dist ./public
COPY apps/miniapp/server.mjs ./server.mjs
USER node
EXPOSE 4173
CMD ["node", "server.mjs"]
