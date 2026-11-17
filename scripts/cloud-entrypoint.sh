#!/bin/sh
set -eu
mkdir -p /app/data/kane-profile /app/data/kane-workspace
chown node:node /app/data /app/data/kane-profile /app/data/kane-workspace
if [ ! -e /app/.testmuai ]; then
  ln -s /app/data/kane-workspace /app/.testmuai
fi
if [ ! -e /home/node/.testmuai ]; then
  ln -s /app/data/kane-profile /home/node/.testmuai
fi
gosu node node /app/scripts/seed-cloud.mjs
exec gosu node npm start
