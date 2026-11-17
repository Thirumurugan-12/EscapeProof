#!/bin/sh
set -eu
mkdir -p /app/data/kane-profile
chown node:node /app/data /app/data/kane-profile
if [ ! -e /home/node/.testmuai ]; then
  ln -s /app/data/kane-profile /home/node/.testmuai
fi
gosu node node /app/scripts/seed-cloud.mjs
exec gosu node npm start
