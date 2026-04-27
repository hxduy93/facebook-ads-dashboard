#!/bin/bash
# Test prompt suggest_keyword sau moi deploy.
# Chay tu Bash (Git Bash tren Windows, hoac WSL).
#
# Yeu cau:
# - .dev.vars co TEST_BYPASS_TOKEN=<value>
# - Cloudflare prod cung phai co bien TEST_BYPASS_TOKEN cung value
#   (Cloudflare dashboard > Pages > project > Settings > Variables and Secrets)
#
# Output:
#   PASS — neu output co dung 1 bang markdown
#   FAIL — neu nhieu bang (multiple separator |---|)

set -e

# Doc TEST_BYPASS_TOKEN tu .dev.vars
if [ ! -f .dev.vars ]; then
  echo "[ERROR] Khong tim thay .dev.vars. Copy tu .dev.vars.example truoc."
  exit 1
fi

TOKEN=$(grep -E '^TEST_BYPASS_TOKEN=' .dev.vars | cut -d'=' -f2- | tr -d '"' | tr -d "'")

if [ -z "$TOKEN" ] || [ "$TOKEN" = "PASTE_RANDOM_LONG_TOKEN_HERE" ]; then
  echo "[ERROR] TEST_BYPASS_TOKEN trong .dev.vars chua duoc set."
  echo "Generate token: openssl rand -hex 32"
  echo "Roi paste vao ca .dev.vars VA Cloudflare Pages env vars."
  exit 1
fi

URL="${1:-https://facebookadsallinone.pages.dev}/api/agent-google-ai"
GROUP="${2:-MAY_DO}"

echo "═══ Test suggest_keyword prompt ═══"
echo "URL    : $URL"
echo "Group  : $GROUP"
echo "Force refresh: true (bypass cache 24h)"
echo ""
echo "Goi API..."

START=$(date +%s)
RESP=$(curl -sS -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "X-Test-Token: $TOKEN" \
  -d "{\"mode\":\"suggest_keyword\",\"context\":{\"product_group\":\"$GROUP\"},\"force_refresh\":true}")
ELAPSED=$(($(date +%s) - START))

# Save response cho debug
echo "$RESP" > /tmp/test-suggest-response.json
echo "Response saved: /tmp/test-suggest-response.json (${ELAPSED}s)"
echo ""

# Check error
ERROR=$(echo "$RESP" | grep -oE '"error":"[^"]*"' | head -1 || true)
if [ -n "$ERROR" ]; then
  echo "[FAIL] API tra error:"
  echo "  $ERROR"
  exit 1
fi

# Extract response.response (markdown text) — naive but works
MARKDOWN=$(echo "$RESP" | grep -oE '"response":"[^"]*' | head -1 | sed 's/^"response":"//' | sed 's/\\n/\n/g')

if [ -z "$MARKDOWN" ]; then
  echo "[FAIL] Response khong co field 'response'. Raw response:"
  echo "$RESP" | head -200
  exit 1
fi

# Dem so separator |---| (header separator cua markdown table)
SEP_COUNT=$(echo "$MARKDOWN" | grep -cE '^\|[-|: ]+\|$' || true)

# Dem so heading "## " hoac "### " (AI tach section)
HEADING_COUNT=$(echo "$MARKDOWN" | grep -cE '^#{1,6} ' || true)

# Dem so dong data (start with "| 1 |", "| 2 |", ...)
ROW_COUNT=$(echo "$MARKDOWN" | grep -cE '^\| *[0-9]+ *\|' || true)

echo "═══ Format check ═══"
echo "Bang markdown (count |---|)       : $SEP_COUNT  (expect: 1)"
echo "Heading H1-H6 (count ## ...)      : $HEADING_COUNT  (expect: 0)"
echo "So row du lieu (| N | ...)        : $ROW_COUNT  (expect: 12-15)"
echo ""

PASS=true
if [ "$SEP_COUNT" -gt 1 ]; then
  echo "[FAIL] Co $SEP_COUNT bang — phai chi 1 bang duy nhat."
  PASS=false
fi
if [ "$HEADING_COUNT" -gt 0 ]; then
  echo "[FAIL] Co $HEADING_COUNT heading markdown — prompt cam them heading."
  PASS=false
fi
if [ "$ROW_COUNT" -lt 12 ] || [ "$ROW_COUNT" -gt 15 ]; then
  echo "[WARN] Row count $ROW_COUNT ngoai khoang 12-15."
fi

if [ "$PASS" = true ]; then
  echo "═══ PASS ═══"
  echo "Output dung format: 1 bang duy nhat $ROW_COUNT rows."
  exit 0
else
  echo "═══ FAIL ═══"
  echo "Xem markdown raw o: /tmp/test-suggest-response.json"
  exit 1
fi
