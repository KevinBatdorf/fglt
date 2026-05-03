FROM oven/bun:debian

WORKDIR /app

# System deps:
# - curl: to fetch supercronic
# - python3 + pipx: to install legendary-gl (Epic Games CLI). pipx
#   gives us a clean isolated install that doesn't fight Debian's
#   externally-managed-environment policy. legendary's own bin lands
#   on PATH at /usr/local/bin/legendary via the pipx symlink we
#   create below.
RUN apt-get update -qq \
    && apt-get install -yqq curl python3 python3-pip python3-venv >/dev/null 2>&1 \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://github.com/aptible/supercronic/releases/download/v0.2.33/supercronic-linux-amd64 -o /usr/local/bin/supercronic \
    && chmod +x /usr/local/bin/supercronic \
    && pip3 install --break-system-packages legendary-gl \
    && which legendary || ln -s "$(python3 -c 'import sysconfig; print(sysconfig.get_path("scripts"))')/legendary" /usr/local/bin/legendary

# legendary stores tokens at $XDG_CONFIG_HOME/legendary/user.json by
# default; the consumer compose mounts a persistent volume at /app/data
# and sets XDG_CONFIG_HOME to it, so tokens survive container rebuilds.

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

COPY . .
