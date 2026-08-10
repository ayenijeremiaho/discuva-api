# Build stage
FROM node:20-alpine AS builder

USER node
WORKDIR /home/node

COPY --chown=node:node package*.json .
RUN npm ci --no-audit

COPY --chown=node:node . .
RUN npm run build && npm prune --omit=dev


# Production stage
FROM node:20-alpine

ENV NODE_ENV=production
USER node
WORKDIR /home/node

COPY --from=builder --chown=node:node /home/node/node_modules ./node_modules
COPY --from=builder --chown=node:node /home/node/dist ./dist
COPY --from=builder --chown=node:node /home/node/docs ./docs

ARG PORT
EXPOSE ${PORT:-3000}

# GET /health checks both Postgres and Redis (src/app.controller.ts) and is
# excluded from TenantMiddleware, so it works regardless of Host header.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD wget -qO- http://127.0.0.1:${PORT:-3000}/health || exit 1

CMD ["node", "dist/main.js"]
