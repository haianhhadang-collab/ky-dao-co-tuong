# Kỳ Đạo – Cờ Tướng Online. Không cần cài thư viện nào ngoài Node.js.
FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY server ./server
COPY public ./public
ENV NODE_ENV=production PORT=3000 DATA_FILE=/data/db.json
# /data chứa tài khoản, điểm, lịch sử ván – hãy gắn ổ đĩa bền vào đây (docker run -v kydao:/data …)
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1
CMD ["node", "server.js"]
