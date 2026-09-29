FROM node:22.22-alpine AS dependencies
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY tsconfig.json tsup.config.ts vitest.config.ts ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY db ./db
RUN pnpm build:server

FROM node:22.22-alpine AS runtime
ENV NODE_ENV=production
ENV NODE_EXTRA_CA_CERTS=/app/certs/russian-trusted-root-ca.crt
WORKDIR /app
RUN addgroup -S first30 && adduser -S -G first30 first30
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/db ./db
COPY assets ./assets
COPY deploy/certs/russian-trusted-root-ca.crt ./certs/russian-trusted-root-ca.crt
COPY package.json ./
USER first30
CMD ["node", "dist/api.js"]
