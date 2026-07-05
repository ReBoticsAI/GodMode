#!/bin/sh
set -e
nginx
exec node /app/apps/bridge/dist/index.js
