#!/usr/bin/env bash
set -euo pipefail

PIN_SERVICE_BASE_URL="${PIN_SERVICE_BASE_URL:-http://127.0.0.1:4100}"
PIN_SERVICE_TOKEN="${PIN_SERVICE_TOKEN:-}"
TEST_CID="${TEST_CID:-bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-5}"
POLL_TIMEOUT_SECONDS="${POLL_TIMEOUT_SECONDS:-1800}"

AUTH_ARGS=()
if [[ -n "${PIN_SERVICE_TOKEN}" ]]; then
  AUTH_ARGS=(-H "Authorization: Bearer ${PIN_SERVICE_TOKEN}")
fi

json_get() {
  local json="$1"
  local key="$2"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "${json}" | jq -r ".${key} // empty"
    return
  fi
  printf '%s' "${json}" | sed -n "s/.*\"${key}\":[ ]*\"\([^\"]*\)\".*/\1/p"
}

print_section() {
  printf '\n== %s ==\n' "$1"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

request() {
  curl -fsS "${AUTH_ARGS[@]}" "$@"
}

print_section "Config"
printf 'PIN_SERVICE_BASE_URL=%s\n' "${PIN_SERVICE_BASE_URL}"
printf 'TEST_CID=%s\n' "${TEST_CID}"
printf 'POLL_INTERVAL_SECONDS=%s\n' "${POLL_INTERVAL_SECONDS}"
printf 'POLL_TIMEOUT_SECONDS=%s\n' "${POLL_TIMEOUT_SECONDS}"
if [[ -n "${PIN_SERVICE_TOKEN}" ]]; then
  printf 'PIN_SERVICE_TOKEN=<set>\n'
else
  printf 'PIN_SERVICE_TOKEN=<empty>\n'
fi

print_section "Health"
health_response="$(request "${PIN_SERVICE_BASE_URL}/health")" || fail "health check failed"
printf '%s\n' "${health_response}"
printf '%s' "${health_response}" | grep -q '"ok"[ ]*:[ ]*true' || fail "health response did not contain ok=true"

print_section "Stats"
stats_response="$(request "${PIN_SERVICE_BASE_URL}/stats")" || fail "stats request failed"
printf '%s\n' "${stats_response}"

print_section "Submit Pin"
submit_payload="$(printf '{"cid":"%s","source":"validate-script","storageType":"ipfs"}' "${TEST_CID}")"
submit_response="$(request -X POST "${PIN_SERVICE_BASE_URL}/pins" -H "Content-Type: application/json" -d "${submit_payload}")" || fail "pin submission failed"
printf '%s\n' "${submit_response}"

request_id="$(json_get "${submit_response}" "requestId")"
status="$(json_get "${submit_response}" "status")"

[[ -n "${request_id}" ]] || fail "requestId missing in submit response"
[[ -n "${status}" ]] || fail "status missing in submit response"

print_section "Poll"
deadline=$(( $(date +%s) + POLL_TIMEOUT_SECONDS ))
while true; do
  poll_response="$(request "${PIN_SERVICE_BASE_URL}/pins/${request_id}")" || fail "poll request failed"
  status="$(json_get "${poll_response}" "status")"
  error_message="$(json_get "${poll_response}" "error")"
  error_code="$(json_get "${poll_response}" "errorCode")"
  attempts="$(json_get "${poll_response}" "attempts")"
  next_retry_at="$(json_get "${poll_response}" "nextRetryAt")"

  printf '%s\n' "${poll_response}"

  case "${status}" in
    pinned)
      print_section "Result"
      printf 'SUCCESS: cid=%s requestId=%s attempts=%s\n' "${TEST_CID}" "${request_id}" "${attempts:-unknown}"
      exit 0
      ;;
    failed)
      fail "pin failed requestId=${request_id} errorCode=${error_code:-unknown} error=${error_message:-unknown}"
      ;;
    queued|pinning)
      ;;
    *)
      fail "unexpected status: ${status:-<empty>}"
      ;;
  esac

  if (( $(date +%s) >= deadline )); then
    fail "poll timed out requestId=${request_id} lastStatus=${status:-unknown} nextRetryAt=${next_retry_at:-unknown}"
  fi

  sleep "${POLL_INTERVAL_SECONDS}"
done
