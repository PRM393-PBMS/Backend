FROM node:24-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma

RUN npm ci

COPY . .

RUN npm run build \
    && npm prune --omit=dev


FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3000
ENV UPLOAD_DIR=/app/public/uploads

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma

RUN mkdir -p /app/public/uploads \
    && chown -R node:node /app/public

USER node

EXPOSE 3000

# Áp migration Prisma lên DB trước khi chạy app, để schema DB luôn khớp code.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]