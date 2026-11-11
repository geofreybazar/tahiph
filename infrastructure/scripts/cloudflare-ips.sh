#!/usr/bin/env bash
# Prints Cloudflare's current IP ranges in the YAML list format used by traefik.yml.
# Review the diff and update infrastructure/traefik/traefik.yml manually.
set -euo pipefail
{ curl -fsS https://www.cloudflare.com/ips-v4; echo; curl -fsS https://www.cloudflare.com/ips-v6; echo; } \
  | sed '/^$/d; s/^/        - /'
