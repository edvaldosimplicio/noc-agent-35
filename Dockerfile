FROM node:20-alpine

WORKDIR /app

# Install backend dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy Prisma schema and generate
COPY prisma ./prisma/
RUN npx prisma generate

# Copy source
COPY src ./src/

# Install and build frontend
COPY frontend/package.json frontend/package-lock.json ./frontend/
WORKDIR /app/frontend
RUN npm ci
COPY frontend ./
RUN npm run build

# Go back to app root
WORKDIR /app

# Create data directory for SQLite
RUN mkdir -p data

EXPOSE 3000

CMD ["node", "src/server.js"]
