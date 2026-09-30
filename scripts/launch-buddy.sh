#!/bin/sh
# Start Claude Buddy in the background. Extra launches exit on their own.
cd "$(dirname "$0")/.." || exit 1
nohup ./node_modules/.bin/electron . >/dev/null 2>&1 &
