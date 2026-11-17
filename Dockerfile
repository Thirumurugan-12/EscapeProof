FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget \
    && wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -O /tmp/chrome.deb \
    && apt-get install -y --no-install-recommends /tmp/chrome.deb \
    && rm /tmp/chrome.deb && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npm install -g @testmuai/kane-cli@0.10.4
COPY . .
RUN npm run build && mkdir -p /app/data /home/node/.testmuai && chown -R node:node /app/data /home/node/.testmuai
ENV HOST=0.0.0.0 PORT=3001 DATA_DIR=/app/data KANE_CLI_CHROME_PATH=/usr/bin/google-chrome
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
