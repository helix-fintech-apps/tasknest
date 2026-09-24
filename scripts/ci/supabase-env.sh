#!/usr/bin/env bash
# Export the local Supabase stack's connection details to later GitHub Actions steps.
#
#   scripts/ci/supabase-env.sh            # after `supabase start` / `supabase db start`
#
# Reads `supabase status -o env` (API_URL, ANON_KEY, SERVICE_ROLE_KEY, DB_URL, ...),
# strips the quotes, masks the keys in logs, and appends them to $GITHUB_ENV together
# with the aliases the app and the test suites read:
#   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL,
#   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, API_BASE_URL (Edge Function `api`).
# Outside Actions (no $GITHUB_ENV) it prints `export ...` lines instead, so you can
# `eval "$(scripts/ci/supabase-env.sh)"` locally.
set -euo pipefail

status="$(supabase status -o env)"

declare -A kv=()
while IFS='=' read -r key value; do
  [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
  value="${value%\"}"
  value="${value#\"}"
  kv["$key"]="$value"
done <<<"$status"

: "${kv[API_URL]:?supabase status did not report API_URL - is the stack running?}"

# Newer CLIs also expose PUBLISHABLE_KEY / SECRET_KEY; prefer the legacy JWT keys the
# Edge Functions and supabase-js both accept, and fall back to the new ones.
anon="${kv[ANON_KEY]:-${kv[PUBLISHABLE_KEY]:-}}"
service="${kv[SERVICE_ROLE_KEY]:-${kv[SECRET_KEY]:-}}"

emit() {
  local k="$1" v="$2"
  if [[ -n "${GITHUB_ENV:-}" ]]; then
    printf '%s=%s\n' "$k" "$v" >>"$GITHUB_ENV"
  else
    printf 'export %s=%q\n' "$k" "$v"
  fi
}

mask() { [[ -n "${GITHUB_ACTIONS:-}" && -n "$1" ]] && echo "::add-mask::$1" || true; }
for k in "${!kv[@]}"; do
  case "$k" in *KEY*|*SECRET*|*PASSWORD*) mask "${kv[$k]}" ;; esac
done

for k in "${!kv[@]}"; do emit "$k" "${kv[$k]}"; done
emit SUPABASE_URL "${kv[API_URL]}"
emit SUPABASE_ANON_KEY "$anon"
emit SUPABASE_SERVICE_ROLE_KEY "$service"
emit SUPABASE_DB_URL "${kv[DB_URL]:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
emit VITE_SUPABASE_URL "${kv[API_URL]}"
emit VITE_SUPABASE_ANON_KEY "$anon"
emit API_BASE_URL "${kv[API_URL]}/functions/v1/api"

if [[ -n "${GITHUB_ENV:-}" ]]; then
  echo "Exported local Supabase env (API_URL=${kv[API_URL]}) to \$GITHUB_ENV"
fi
