# GodMode Layer 4 build supervisor (#164 / #167 / #170 / #112)
#
# Privileged host helper that runs ephemeral `docker run --rm` builds with a
# single RW bind to `tenant-workspaces/<tenantId>`. Bridge never mounts
# docker.sock; it calls this service over localhost bearer auth.
#
# Network modes (CODING_BUILD_NET):
#   none (default) - docker --network none
#   allowlist - Docker --internal network (no public internet route) +
#               HTTP(S)_PROXY to a host CONNECT proxy (npm/git; 80/443).
#               Host allowlist still enforced on CONNECT. Not a shared network.
#
# Quick start (host with Docker):
#   export CODING_BUILD_SUPERVISOR_TOKEN=$(openssl rand -hex 24)
#   export GODMODE_DATA_DIR=/path/to/platform-data
#   export PLATFORM_DATA_DIR=$GODMODE_DATA_DIR
#   node server.mjs
#
# Or: docker compose -f docker-compose.yml up -d --build
# (image includes Docker CLI; socket is mounted; GODMODE_DATA_DIR is bind-mounted
# onto the same host path so ephemeral `docker run -v` binds resolve correctly)

#
# Publish notes: compose binds 8792/8793 on 0.0.0.0 so Linux containers can
# reach the supervisor via host.docker.internal (host-gateway). Firewall WAN.
# Bearer token is still required on /v1/build.
#
# Bridge env:
#   CODING_BUILD_MODE=ephemeral
#   CODING_BUILD_SUPERVISOR_URL=http://host.docker.internal:8792
#   CODING_BUILD_SUPERVISOR_TOKEN=<same token>
#   CODING_BUILD_NET=none
#   # CODING_BUILD_NET=allowlist
#   # CODING_BUILD_EGRESS_HOSTS=registry.npmjs.org,github.com
#   # CODING_BUILD_EGRESS_NETWORK=godmode-build-egress
