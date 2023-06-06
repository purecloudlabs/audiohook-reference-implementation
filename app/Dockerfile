ARG NODE_VERSION=16

# First, build the project
FROM node:${NODE_VERSION} AS builder

WORKDIR /buildarea/

COPY [\
    "./.eslintrc",\
    "./.eslintignore",\
    "./package.json",\
    "./package-lock.json",\
    "./tsconfig.json",\
    "/buildarea/"\
]

RUN npm ci

COPY "./src" "/buildarea/src/"
COPY "./audiohook" "/buildarea/audiohook/"

RUN npm run build

RUN npm prune --production

#RUN du -h /buildarea 1>&2 && exit 1
#RUN find /buildarea/dist 1>&2 && exit 1

# Now create the runtime image and copy the build artifacts into it
FROM node:${NODE_VERSION}-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV LOG_ROOT_DIR=/tmp/
ENV SERVERPORT=8080
ENV SERVERHOST=0.0.0.0
EXPOSE $SERVERPORT

COPY --from=builder "/buildarea/node_modules/" "/app/node_modules"
COPY --from=builder "/buildarea/dist" "/app/dist"

USER node
ENTRYPOINT ["node", "/app/dist/src/index.js"]
