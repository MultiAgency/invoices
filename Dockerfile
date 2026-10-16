FROM node:24-slim AS build
WORKDIR /app
RUN npm install -g pnpm@12.11.2
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
FROM node:24-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY scripts/serve.mjs ./scripts/serve.mjs
ENV HOST=0.0.0.0 PORT=8080
USER node
CMD ["node", "scripts/serve.mjs"]
