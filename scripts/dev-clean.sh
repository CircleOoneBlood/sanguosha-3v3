#!/usr/bin/env bash
set -euo pipefail

PORTS=(3001 5173 5174)

echo "[dev-clean] checking ports: ${PORTS[*]}"
for p in "${PORTS[@]}"; do
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${p}/tcp" 2>/dev/null || true
  else
    pids=$(ss -lptn "sport = :${p}" 2>/dev/null | awk -F'pid=' 'NF>1{print $2}' | awk -F',' '{print $1}' | tr -d ' ' | sort -u)
    if [ -n "${pids:-}" ]; then
      echo "$pids" | xargs -r kill -9
    fi
  fi
  echo "[dev-clean] port ${p} ready"
done
