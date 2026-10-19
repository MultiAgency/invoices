FROM node:24.22.0-slim AS build
WORKDIR /app
RUN npm install -g pnpm@12.14.0
COPY package.json pnpm-lock.yaml ./
COPY scripts/release-mode.mjs ./scripts/
# Images are built only from a release candidate: a dev link: has no target inside the image.
RUN node scripts/release-mode.mjs
COPY vendor ./vendor
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
# Stage this build as the image's baked release (id = its digest), outside RELEASES_ROOT.
RUN cp node_modules/@multiagency/sdk/bin/release-server.mjs /release-server.mjs \
 && RELEASES_ROOT=/baked node /release-server.mjs activate "$(RELEASES_ROOT=/baked node /release-server.mjs stage dist)"
FROM node:24.22.0-slim
COPY --from=build /release-server.mjs /app/release-server.mjs
COPY --from=build /app/scripts/entrypoint.mjs /app/entrypoint.mjs
COPY --from=build /baked /app/baked
# RELEASES_ROOT is the service's persistent volume: it keeps every staged release, ACTIVE and HISTORY, so rollback is
# `activate <previous id>` and pages opened before a switch keep their hashed assets. An empty one gets this release.
RUN mkdir /releases && chown node /releases
ENV HOST=0.0.0.0 PORT=8080 RELEASES_ROOT=/releases
USER node
CMD ["node", "/app/entrypoint.mjs"]
