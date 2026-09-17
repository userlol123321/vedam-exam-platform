FROM node:20-bookworm-slim

# Built-in judge runtimes: Python 3 + JDK (Node is already present).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 default-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV JUDGE0_MODE=LOCAL
EXPOSE 10000

CMD ["npm", "start"]
