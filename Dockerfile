FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Copy Prisma schema and generate
COPY prisma ./prisma/
RUN npx prisma generate

# Copy source
COPY src ./src/

# Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
RUN npm run production

# Final stage
FROM node:20-alpine
WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/prisma ./prisma
COPY --from=base /app/package.json ./
COPY --from=base /app/src ./src/
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Create data directory for SQLite
RUN mkdir -p data

EXPOSE 3000

CMD ["node", "src/server.js"]
