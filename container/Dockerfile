# Ingest container: Bun + yt-dlp + ffmpeg
FROM oven/bun:1.3-debian

# ffmpeg + python (for yt-dlp) + ca-certificates
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# yt-dlp: pull the standalone binary (self-updating, no pip needed)
RUN curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app
COPY package.json ./
# Only grammy/containers are workerd deps; the container needs no extra npm deps
# beyond what Bun provides (Bun.S3Client, Bun.spawn). Install is a no-op-ish but
# keeps the layer cache stable.
RUN bun install --production || true

COPY container ./container
COPY src/shared/dto.ts ./src/shared/dto.ts

EXPOSE 8080
CMD ["bun", "run", "container/server.ts"]
