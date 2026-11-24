FROM node:22-alpine AS web
WORKDIR /web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build

FROM node:22-alpine AS api
WORKDIR /app
COPY apps/server/package.json apps/server/package-lock.json ./
RUN npm ci
COPY apps/server/tsconfig.json apps/server/tsconfig.build.json apps/server/nest-cli.json ./
COPY apps/server/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV WEB_ROOT=/app/web
COPY --from=api /app/package.json ./
COPY --from=api /app/node_modules ./node_modules
COPY --from=api /app/dist ./dist
COPY --from=web /web/dist ./web
RUN mkdir -p /app/data
EXPOSE 5000
CMD ["node", "dist/main.js"]
