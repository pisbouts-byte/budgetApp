#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${1:-${API_BASE_URL:-https://spend-tracker-api.onrender.com}}"
HEALTH_URL="${API_BASE_URL%/}/health"
METRICS_URL="${API_BASE_URL%/}/health/metrics"

echo "Incident quick check"
echo "API: ${API_BASE_URL}"
echo

check_endpoint() {
  local label="$1"
  local url="$2"
  local tmp_body
  tmp_body="$(mktemp)"

  local result
  result="$(curl -sS -o "$tmp_body" -w "code=%{http_code} time=%{time_total}" "$url" || true)"
  local code
  local time
  code="$(echo "$result" | awk '{print $1}' | cut -d= -f2)"
  time="$(echo "$result" | awk '{print $2}' | cut -d= -f2)"

  echo "[${label}] ${url}"
  echo "  status: ${code:-000}"
  echo "  latency: ${time:-n/a}s"
  echo "  body: $(tr '\n' ' ' < "$tmp_body" | head -c 220)"
  echo

  rm -f "$tmp_body"
}

echo "Checking TLS/headers..."
curl -sSI "${HEALTH_URL}" | head -n 8 || true
echo

check_endpoint "health" "$HEALTH_URL"
check_endpoint "metrics" "$METRICS_URL"

echo "Done."
