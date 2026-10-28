FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json vite.config.ts ./
COPY server ./server
COPY shared ./shared
COPY client ./client
RUN npm run check && npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3000 DB_PATH=/app/data/world.sqlite
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force && mkdir -p /app/data && chown node:node /app/data
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
CMD ["node", "dist/server/index.js"]
