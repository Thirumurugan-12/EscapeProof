#!/bin/sh
# Railway containers do not provide Chrome's host sandbox or a large /dev/shm.
exec /usr/bin/google-chrome --no-sandbox --disable-dev-shm-usage "$@"
