FROM oven/bun:1 AS base
WORKDIR /usr/src/app

RUN mkdir -p /usr/src/app/data/.cached_attachments && chmod -R 777 /usr/src/app/data
RUN mkdir -p /usr/src/app/logs && chmod -R 777 /usr/src/app/logs

FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lock /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .

FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules
COPY --from=prerelease /usr/src/app/index.ts .
COPY --from=prerelease /usr/src/app/package.json .

USER bun
ENTRYPOINT [ "bun", "run", "index.ts" ]