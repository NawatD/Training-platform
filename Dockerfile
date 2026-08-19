FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

# App source
COPY server ./server
COPY public ./public
COPY db ./db

ENV NODE_ENV=production
ENV STORAGE_DIR=/data/storage
RUN mkdir -p /data/storage

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server/src/index.js"]
