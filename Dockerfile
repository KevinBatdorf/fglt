FROM oven/bun:debian

WORKDIR /app

# supercronic for cron workers
RUN apt-get update -qq && apt-get install -yqq curl >/dev/null 2>&1 && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://github.com/aptible/supercronic/releases/download/v0.2.33/supercronic-linux-amd64 -o /usr/local/bin/supercronic \
    && chmod +x /usr/local/bin/supercronic

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

COPY . .
