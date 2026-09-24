#!/usr/bin/env bash
# Fail fast (with a helpful message) if the repo has no supabase/config.toml.
# `supabase start` / `supabase db start` need it. The config is part of the app, so CI
# does not invent one silently: set ALLOW_GENERATED_SUPABASE_CONFIG=1 to generate a
# default one (useful while the repo is being bootstrapped).
set -euo pipefail

if [[ -f supabase/config.toml ]]; then
  exit 0
fi

if [[ "${ALLOW_GENERATED_SUPABASE_CONFIG:-0}" == "1" ]]; then
  echo "::warning file=supabase/config.toml::supabase/config.toml is missing; generating defaults with 'supabase init'. Commit a real config."
  # `supabase init` refuses to overwrite and would also create supabase/ which exists.
  tmp="$(mktemp -d)"
  (cd "$tmp" && supabase init --yes >/dev/null)
  sed "s/^project_id = .*/project_id = \"tasknest\"/" "$tmp/supabase/config.toml" >supabase/config.toml
  exit 0
fi

echo "::error file=supabase/config.toml::supabase/config.toml is missing. Run 'npx supabase init' and commit it."
exit 1
