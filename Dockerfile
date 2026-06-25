FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma/
RUN npx prisma generate

COPY src ./src/

COPY frontend/package.json frontend/package-lock.json ./frontend/
WORKDIR /app/frontend
RUN npm ci
COPY frontend ./
RUN npm run build

WORKDIR /app

RUN mkdir -p data

ENV DATABASE_URL="file:./data/noc-agent.db"
ENV NODE_ENV="production"
ENV PORT=3000

EXPOSE 3000

CMD npx prisma db push --skip-generate && node src/server.js
