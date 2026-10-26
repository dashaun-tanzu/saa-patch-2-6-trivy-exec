#!/usr/bin/env bash
# Fast stand-in for demo.sh used by scripts/smoke-test.js.
# Mimics demo-magic's talkingPoint: clear the screen, print a beat marker,
# then wait for a keypress before the next clear.
set -u
clear
echo "#### Beat 1 - baseline"
echo "some output here"
read -rsn 1
clear
echo "#### Beat 2 - advisor build-config get"
echo "more output here"
read -rsn 1
clear
echo "#### Beat 3 - upgrade-plan apply"
echo "final output here"
read -rsn 1
clear
echo "#### Beat 4 - done"
exit 0
