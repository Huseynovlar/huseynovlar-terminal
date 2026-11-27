FROM node:22-alpine AS builder
WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app

RUN apk add --no-cache nginx curl

COPY --from=builder /app/.output /app/.output
COPY deploy/nginx/terminal.conf /etc/nginx/terminal.conf


RUN printf '#!/bin/sh\nset -e\nPORT=3000 HOST=127.0.0.1 node /app/.output/server/index.mjs &\nexec nginx -e /dev/stderr -c /etc/nginx/terminal.conf -g "daemon off;"\n' > /app/start.sh \
    && chmod +x /app/start.sh

USER node
EXPOSE 8080
CMD ["/app/start.sh"]
