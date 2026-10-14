FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/client/package.json apps/client/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/render/package.json packages/render/package.json
COPY packages/content/package.json packages/content/package.json
RUN npm ci
COPY . .
RUN npm run build -w @clockwork/shared && npm run build -w @clockwork/content && npm run build -w @clockwork/server

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/content/dist ./packages/content/dist
COPY --from=build /app/packages/content/package.json ./packages/content/package.json
CMD ["node", "apps/server/dist/index.js"]
