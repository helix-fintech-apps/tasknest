#!/usr/bin/env bash
# Bundle each Edge Function into ONE ESM file: dist/functions/<name>/index.js
#
# For tools that deploy a single file whose content travels inline as a JSON string (for example the
# Supabase MCP `deploy_edge_function`). `supabase functions deploy` does NOT need this.
#
# The output is made easy to embed in JSON:
#   * one line (esbuild --minify-whitespace; identifiers are NOT mangled, so logs stay readable),
#   * string literals re-quoted with single quotes (TypeScript scanner, so regex/template literals are safe),
#   * npm: specifiers (supabase-js) stay external; Deno resolves them at runtime.
# Every file is checked: it must parse, and re-printing it with esbuild must give byte-for-byte the same
# output as the un-re-quoted bundle (i.e. re-quoting changed no semantics).
#
#   scripts/bundle-edge-functions.sh              # -> dist/functions/{api,stripe-webhook}/index.js
#   OUT_DIR=/tmp/fns scripts/bundle-edge-functions.sh
set -euo pipefail
cd "$(dirname "$0")/.."
out_dir="${OUT_DIR:-dist/functions}"

requote() {
  node - "$1" "$2" <<'NODE'
const fs = require("fs");
const ts = require(require.resolve("typescript", { paths: [process.cwd()] }));
const [, , inFile, outFile] = process.argv;
const src = fs.readFileSync(inFile, "utf8");
const K = ts.SyntaxKind;
const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, src);
// Tokens after which "/" is division, not the start of a regex literal.
const exprEnd = new Set([
  K.Identifier, K.NumericLiteral, K.BigIntLiteral, K.StringLiteral, K.RegularExpressionLiteral,
  K.NoSubstitutionTemplateLiteral, K.TemplateTail, K.CloseParenToken, K.CloseBracketToken,
  K.CloseBraceToken, K.ThisKeyword, K.SuperKeyword, K.TrueKeyword, K.FalseKeyword, K.NullKeyword,
  K.PlusPlusToken, K.MinusMinusToken,
]);
let out = "";
let prev = K.Unknown;
const braces = []; // true: this "}" closes a template substitution
for (;;) {
  let tok = scanner.scan();
  if (tok === K.EndOfFileToken) break;
  if ((tok === K.SlashToken || tok === K.SlashEqualsToken) && !exprEnd.has(prev)) tok = scanner.reScanSlashToken();
  if (tok === K.OpenBraceToken) braces.push(false);
  if (tok === K.TemplateHead) braces.push(true);
  if (tok === K.CloseBraceToken && braces.pop()) {
    tok = scanner.reScanTemplateToken(false);
    if (tok === K.TemplateMiddle) braces.push(true);
  }
  const raw = src.slice(scanner.getTokenStart(), scanner.getTextPos());
  if (tok === K.StringLiteral && raw.startsWith('"') && !raw.includes("'")) {
    out += "'" + raw.slice(1, -1).replace(/\\"/g, '"') + "'";
  } else {
    out += raw;
  }
  if (tok !== K.WhitespaceTrivia && tok !== K.NewLineTrivia) prev = tok;
}
fs.writeFileSync(outFile, out);
NODE
}

for fn in api stripe-webhook; do
  dir="$out_dir/$fn"
  mkdir -p "$dir"
  npx esbuild "supabase/functions/$fn/index.ts" --bundle --format=esm --platform=neutral --target=es2022 \
    --external:'npm:*' --legal-comments=none --minify-syntax --minify-whitespace \
    --outfile="$dir/plain.js" --log-level=warning
  requote "$dir/plain.js" "$dir/index.js"
  node --check "$dir/index.js"
  a="$(npx esbuild "$dir/plain.js" --minify-syntax --minify-whitespace --format=esm --log-level=warning)"
  b="$(npx esbuild "$dir/index.js" --minify-syntax --minify-whitespace --format=esm --log-level=warning)"
  if [[ "$a" != "$b" ]]; then
    echo "re-quoting changed $fn: refusing to emit" >&2
    exit 1
  fi
  rm "$dir/plain.js"
  echo "bundled $dir/index.js ($(wc -c <"$dir/index.js") bytes, $(tr -cd '"\\' <"$dir/index.js" | wc -c) chars to JSON-escape)"
done
