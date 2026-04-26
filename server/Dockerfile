FROM node:20-alpine

WORKDIR /app

# Install deps (cached layer)
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Install tsx for runtime TypeScript
RUN npm install tsx --no-audit --no-fund

# App code
COPY server/src ./src
COPY server/tsconfig.json ./

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["npx", "tsx", "src/index.ts"]
