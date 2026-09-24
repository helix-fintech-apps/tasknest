#!/usr/bin/env bash
# Wait until an HTTP endpoint answers with anything other than a gateway error.
#
#   scripts/ci/wait-for-http.sh <url> [timeout_seconds=90] [log_file_to_dump_on_timeout]
#
# A 401/404 from the Edge Function still proves the runtime is up (the `api` function
# rejects unauthenticated calls), so only "no connection" and 502/503/504 keep waiting.
set -euo pipefail

url="${1:?usage: wait-for-http.sh <url> [timeout] [log]}"
timeout="${2:-90}"
log="${3:-}"

deadline=$((SECONDS + timeout))
while ((SECONDS < deadline)); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" || true)"
  case "$code" in
    000 | 502 | 503 | 504) sleep 2 ;;
    *)
      echo "$url is up (HTTP $code) after ${SECONDS}s"
      exit 0
      ;;
  esac
done

echo "::error::Timed out after ${timeout}s waiting for $url (last HTTP code: ${code:-none})"
if [[ -n "$log" && -f "$log" ]]; then
  echo "----- $log -----"
  tail -n 200 "$log"
fi
exit 1
