#!/usr/bin/env bash
set -euo pipefail

# This project is a static web app. It has no database migrations or build step.
# Reinstall the locked test dependencies, then verify the merged code.
npm ci --ignore-scripts --no-audit --no-fund --prefer-offline
npm test
