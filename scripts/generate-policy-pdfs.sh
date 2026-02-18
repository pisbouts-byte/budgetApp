#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p docs/compliance

cupsfilter docs/compliance/privacy-policy.md > docs/compliance/privacy-policy.pdf
cupsfilter docs/compliance/sole-prop-information-security-policy.md > docs/compliance/sole-prop-information-security-policy.pdf

echo "Generated:"
echo " - docs/compliance/privacy-policy.pdf"
echo " - docs/compliance/sole-prop-information-security-policy.pdf"
