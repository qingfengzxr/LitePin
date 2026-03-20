#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIN_SERVICE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${PIN_SERVICE_ROOT}/.." && pwd)"
BACKEND_ROOT="${REPO_ROOT}/backend"

SQLITE_BIN="${SQLITE_BIN:-$(command -v sqlite3 || true)}"
TAIL_LINES="${TAIL_LINES:-200}"

REQUEST_ID=""
CID=""
BACKEND_JOB_ID=""

usage() {
  cat <<'EOF'
Usage:
  ./pin-service/scripts/diagnose-pin-job.sh [--request-id ID] [--cid CID] [--backend-job-id ID]

Description:
  Correlate pin-service logs, backend logs, and both SQLite databases for one pin flow.

Examples:
  ./pin-service/scripts/diagnose-pin-job.sh --request-id pin-1773938242644-52acbb
  ./pin-service/scripts/diagnose-pin-job.sh --cid bafkreiaz7oeru2fhf3namjiu3d3uupzy2qabfbkt3uzdinlo53cp5gh3j4
  ./pin-service/scripts/diagnose-pin-job.sh --backend-job-id 52

Environment:
  PIN_DB_PATH       Override pin-service sqlite path
  BACKUP_DB_PATH    Override backend sqlite path
  PIN_SERVICE_LOG   Override pin-service log path
  BACKEND_LOG       Override backend log path
  SQLITE_BIN        Override sqlite3 binary
  TAIL_LINES        Log excerpt size, default 200
EOF
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

print_section() {
  printf '\n== %s ==\n' "$1"
}

have_sqlite() {
  [[ -n "${SQLITE_BIN}" && -x "${SQLITE_BIN}" ]]
}

resolve_first_existing() {
  local candidate
  for candidate in "$@"; do
    [[ -n "${candidate}" ]] || continue
    if [[ -f "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  printf '%s\n' "${1:-}"
}

sql_escape() {
  printf "%s" "$1" | sed "s/'/''/g"
}

query_db() {
  local db_path="$1"
  local sql="$2"
  "${SQLITE_BIN}" -readonly -header -column "${db_path}" "${sql}"
}

resolve_request_id_from_backend_job() {
  local job_id="$1"
  query_db "${BACKEND_DB}" "SELECT remote_job_id FROM backup_jobs WHERE id = ${job_id};" | awk 'NR>2 && NF {print $1; exit}'
}

resolve_cid_from_backend_job() {
  local job_id="$1"
  query_db "${BACKEND_DB}" "
    SELECT us.onchain_id
    FROM backup_jobs bj
    JOIN upload_sources us ON us.id = bj.upload_source_id
    WHERE bj.id = ${job_id};
  " | awk 'NR>2 && NF {print $1; exit}'
}

resolve_request_id_from_cid() {
  local cid="$1"
  local escaped
  escaped="$(sql_escape "${cid}")"
  query_db "${PIN_SERVICE_DB}" "SELECT id FROM pin_requests WHERE cid = '${escaped}';" | awk 'NR>2 && NF {print $1; exit}'
}

resolve_cid_from_request_id() {
  local request_id="$1"
  local escaped
  escaped="$(sql_escape "${request_id}")"
  query_db "${PIN_SERVICE_DB}" "SELECT cid FROM pin_requests WHERE id = '${escaped}';" | awk 'NR>2 && NF {print $1; exit}'
}

resolve_backend_job_id_from_request_id() {
  local request_id="$1"
  local escaped
  escaped="$(sql_escape "${request_id}")"
  query_db "${BACKEND_DB}" "SELECT id FROM backup_jobs WHERE remote_job_id = '${escaped}' ORDER BY id DESC;" | awk 'NR>2 && NF {print $1; exit}'
}

resolve_backend_job_id_from_cid() {
  local cid="$1"
  local escaped
  escaped="$(sql_escape "${cid}")"
  query_db "${BACKEND_DB}" "
    SELECT bj.id
    FROM backup_jobs bj
    JOIN upload_sources us ON us.id = bj.upload_source_id
    WHERE us.onchain_id = '${escaped}'
    ORDER BY bj.id DESC;
  " | awk 'NR>2 && NF {print $1; exit}'
}

db_has_file() {
  [[ -n "${1:-}" && -f "${1}" ]]
}

print_file_status() {
  local label="$1"
  local path="$2"
  if [[ -f "${path}" ]]; then
    printf '%s=%s\n' "${label}" "${path}"
  else
    printf '%s=%s (missing)\n' "${label}" "${path}"
  fi
}

print_pin_service_db() {
  if ! db_has_file "${PIN_SERVICE_DB}"; then
    return 0
  fi
  local escaped_request escaped_cid where_clause
  escaped_request="$(sql_escape "${REQUEST_ID}")"
  escaped_cid="$(sql_escape "${CID}")"
  where_clause="id = '${escaped_request}'"
  if [[ -n "${CID}" ]]; then
    where_clause="${where_clause} OR cid = '${escaped_cid}'"
  fi

  print_section "Pin Service DB"
  query_db "${PIN_SERVICE_DB}" "
    SELECT id, cid, status, error_code, attempts, next_retry_at, started_at, completed_at, updated_at
    FROM pin_requests
    WHERE ${where_clause}
    ORDER BY updated_at DESC;
  "
  echo
  query_db "${PIN_SERVICE_DB}" "
    SELECT id, cid, status, error_code, error
    FROM pin_requests
    WHERE ${where_clause}
    ORDER BY updated_at DESC;
  "
}

print_backend_db() {
  if ! db_has_file "${BACKEND_DB}"; then
    return 0
  fi
  local conditions=()
  if [[ -n "${BACKEND_JOB_ID}" ]]; then
    conditions+=("bj.id = ${BACKEND_JOB_ID}")
  fi
  if [[ -n "${REQUEST_ID}" ]]; then
    conditions+=("bj.remote_job_id = '$(sql_escape "${REQUEST_ID}")'")
  fi
  if [[ -n "${CID}" ]]; then
    conditions+=("us.onchain_id = '$(sql_escape "${CID}")'")
  fi
  if [[ "${#conditions[@]}" -eq 0 ]]; then
    return 0
  fi

  local where_clause=""
  local condition
  for condition in "${conditions[@]}"; do
    if [[ -n "${where_clause}" ]]; then
      where_clause="${where_clause} OR "
    fi
    where_clause="${where_clause}${condition}"
  done

  print_section "Backend DB"
  query_db "${BACKEND_DB}" "
    SELECT
      bj.id,
      bj.target_provider,
      bj.status,
      bj.attempts,
      bj.remote_job_id,
      bj.remote_status,
      bj.last_error,
      bj.next_retry_at,
      us.address,
      us.onchain_id,
      us.storage_type,
      bj.updated_at
    FROM backup_jobs bj
    JOIN upload_sources us ON us.id = bj.upload_source_id
    WHERE ${where_clause}
    ORDER BY bj.updated_at DESC;
  "
}

grep_log() {
  local label="$1"
  local file_path="$2"
  local patterns=("${@:3}")

  print_section "${label}"
  if [[ ! -f "${file_path}" ]]; then
    printf 'log file missing: %s\n' "${file_path}"
    return
  fi

  local temp_file
  temp_file="$(mktemp)"
  tail -n "${TAIL_LINES}" "${file_path}" > "${temp_file}" || true

  local matched=0
  local pattern
  for pattern in "${patterns[@]}"; do
    [[ -n "${pattern}" ]] || continue
    if grep -F -- "${pattern}" "${temp_file}" >/dev/null 2>&1; then
      matched=1
      printf '%s\n' "-- matches for: ${pattern}"
      grep -F -- "${pattern}" "${temp_file}" || true
      echo
    fi
  done

  if [[ "${matched}" -eq 0 ]]; then
    printf 'no matching lines in last %s lines of %s\n' "${TAIL_LINES}" "${file_path}"
  fi

  rm -f "${temp_file}"
}

print_summary() {
  local pin_status=""
  local pin_error_code=""
  local backend_status=""
  local backend_remote_status=""

  if db_has_file "${PIN_SERVICE_DB}"; then
    pin_status="$(query_db "${PIN_SERVICE_DB}" "SELECT status FROM pin_requests WHERE id = '$(sql_escape "${REQUEST_ID}")';" | awk 'NR>2 && NF {print $1; exit}')"
    pin_error_code="$(query_db "${PIN_SERVICE_DB}" "SELECT error_code FROM pin_requests WHERE id = '$(sql_escape "${REQUEST_ID}")';" | awk 'NR>2 && NF {print $1; exit}')"
  fi

  if db_has_file "${BACKEND_DB}"; then
    if [[ -n "${BACKEND_JOB_ID}" ]]; then
      backend_status="$(query_db "${BACKEND_DB}" "SELECT status FROM backup_jobs WHERE id = ${BACKEND_JOB_ID};" | awk 'NR>2 && NF {print $1; exit}')"
      backend_remote_status="$(query_db "${BACKEND_DB}" "SELECT remote_status FROM backup_jobs WHERE id = ${BACKEND_JOB_ID};" | awk 'NR>2 && NF {print $1; exit}')"
    elif [[ -n "${REQUEST_ID}" ]]; then
      backend_status="$(query_db "${BACKEND_DB}" "SELECT status FROM backup_jobs WHERE remote_job_id = '$(sql_escape "${REQUEST_ID}")' ORDER BY id DESC;" | awk 'NR>2 && NF {print $1; exit}')"
      backend_remote_status="$(query_db "${BACKEND_DB}" "SELECT remote_status FROM backup_jobs WHERE remote_job_id = '$(sql_escape "${REQUEST_ID}")' ORDER BY id DESC;" | awk 'NR>2 && NF {print $1; exit}')"
    fi
  fi

  print_section "Diagnosis Summary"
  printf 'requestId=%s\n' "${REQUEST_ID:-<unknown>}"
  printf 'cid=%s\n' "${CID:-<unknown>}"
  printf 'backendJobId=%s\n' "${BACKEND_JOB_ID:-<unknown>}"
  printf 'pinServiceStatus=%s\n' "${pin_status:-<unknown>}"
  printf 'pinServiceErrorCode=%s\n' "${pin_error_code:-<none>}"
  printf 'backendStatus=%s\n' "${backend_status:-<unknown>}"
  printf 'backendRemoteStatus=%s\n' "${backend_remote_status:-<unknown>}"

  if [[ "${pin_error_code}" == "cid_unavailable" ]]; then
    echo "verdict=CID content is currently unavailable from Kubo/IPFS peers; pin-service will retry until max retries, then mark failed"
  elif [[ "${pin_status}" == "failed" && "${backend_status}" == "failed" ]]; then
    echo "verdict=pin-service failed and backend has already absorbed that failure"
  elif [[ "${pin_status}" == "queued" || "${pin_status}" == "pinning" ]]; then
    echo "verdict=pin-service still has the request in progress or queued for retry"
  elif [[ "${pin_status}" == "pinned" && "${backend_status}" == "completed" ]]; then
    echo "verdict=pinning completed end-to-end"
  else
    echo "verdict=inspect the DB rows and log excerpts above; state is mixed or incomplete"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --request-id)
      [[ $# -ge 2 ]] || fail "--request-id requires a value"
      REQUEST_ID="$2"
      shift 2
      ;;
    --cid)
      [[ $# -ge 2 ]] || fail "--cid requires a value"
      CID="$2"
      shift 2
      ;;
    --backend-job-id)
      [[ $# -ge 2 ]] || fail "--backend-job-id requires a value"
      BACKEND_JOB_ID="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

if [[ -z "${REQUEST_ID}" && -z "${CID}" && -z "${BACKEND_JOB_ID}" ]]; then
  usage
  exit 1
fi

have_sqlite || fail "sqlite3 not found; set SQLITE_BIN"

PIN_SERVICE_DB="${PIN_DB_PATH:-$(resolve_first_existing \
  "${PIN_SERVICE_ROOT}/data/pin-service.sqlite" \
  "${REPO_ROOT}/data/pin-service.sqlite" \
  "/data/pin-service.sqlite")}"
BACKEND_DB="${BACKUP_DB_PATH:-${IDENTITY_DB_PATH:-$(resolve_first_existing \
  "${BACKEND_ROOT}/data/backend.sqlite" \
  "${REPO_ROOT}/data/backend.sqlite" \
  "/data/backend.sqlite")}}"
PIN_SERVICE_LOG="${PIN_SERVICE_LOG:-$(resolve_first_existing \
  "${PIN_SERVICE_ROOT}/data/logs/pin-service.log" \
  "${PIN_SERVICE_ROOT}/logs/pin-service.log" \
  "${REPO_ROOT}/data/logs/pin-service.log" \
  "/data/logs/pin-service.log")}"
BACKEND_LOG="${BACKEND_LOG:-$(resolve_first_existing \
  "${BACKEND_ROOT}/data/logs/backend.log" \
  "${BACKEND_ROOT}/logs/backend.log" \
  "${REPO_ROOT}/data/logs/backend.log" \
  "/data/logs/backend.log")}"

if [[ -n "${BACKEND_JOB_ID}" ]]; then
  if [[ -z "${REQUEST_ID}" && -f "${BACKEND_DB}" ]]; then
    REQUEST_ID="$(resolve_request_id_from_backend_job "${BACKEND_JOB_ID}")"
  fi
  if [[ -z "${CID}" && -f "${BACKEND_DB}" ]]; then
    CID="$(resolve_cid_from_backend_job "${BACKEND_JOB_ID}")"
  fi
fi

if [[ -n "${CID}" ]]; then
  if [[ -z "${REQUEST_ID}" && -f "${PIN_SERVICE_DB}" ]]; then
    REQUEST_ID="$(resolve_request_id_from_cid "${CID}")"
  fi
  if [[ -z "${BACKEND_JOB_ID}" && -f "${BACKEND_DB}" ]]; then
    BACKEND_JOB_ID="$(resolve_backend_job_id_from_cid "${CID}")"
  fi
fi

if [[ -n "${REQUEST_ID}" ]]; then
  if [[ -z "${CID}" && -f "${PIN_SERVICE_DB}" ]]; then
    CID="$(resolve_cid_from_request_id "${REQUEST_ID}")"
  fi
  if [[ -z "${BACKEND_JOB_ID}" && -f "${BACKEND_DB}" ]]; then
    BACKEND_JOB_ID="$(resolve_backend_job_id_from_request_id "${REQUEST_ID}")"
  fi
fi

print_section "Config"
print_file_status "PIN_SERVICE_DB" "${PIN_SERVICE_DB}"
print_file_status "BACKEND_DB" "${BACKEND_DB}"
print_file_status "PIN_SERVICE_LOG" "${PIN_SERVICE_LOG}"
print_file_status "BACKEND_LOG" "${BACKEND_LOG}"
printf 'REQUEST_ID=%s\n' "${REQUEST_ID:-<unknown>}"
printf 'CID=%s\n' "${CID:-<unknown>}"
printf 'BACKEND_JOB_ID=%s\n' "${BACKEND_JOB_ID:-<unknown>}"
printf 'TAIL_LINES=%s\n' "${TAIL_LINES}"

print_pin_service_db
print_backend_db
grep_log "Pin Service Log" "${PIN_SERVICE_LOG}" "${REQUEST_ID}" "${CID}" "cid_unavailable" "[pin-worker] scheduled retry" "[pin-worker] pin request marked failed"
grep_log "Backend Log" "${BACKEND_LOG}" "${REQUEST_ID}" "${CID}" "\"jobId\":${BACKEND_JOB_ID}" "[backup-worker] provider reported failed" "[backup-worker] scheduled retry after submit failure"
print_summary
