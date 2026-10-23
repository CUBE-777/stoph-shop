#!/bin/bash
# usage: run.sh script.cjs  (rebuilds bundle, starts server, runs script, stops server)
cd /tmp/harness && node build.mjs >/dev/null || exit 1
node server.mjs >/tmp/harness/server.log 2>&1 & SP=$!
sleep 0.8
NODE_PATH=$(npm root -g) node "$@"; RC=$?
kill $SP 2>/dev/null; exit $RC
