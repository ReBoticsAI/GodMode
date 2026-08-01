# Layer 4 host build supervisor: Node API + Docker CLI against mounted docker.sock.
# Bridge never mounts the socket; only this service does.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends docker.io ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /supervisor
# Compose bind-mounts this directory read-only at runtime.
CMD ["node", "server.mjs"]
