#!/bin/bash
# Builds the offline release zip: the committed code plus production-only node_modules,
# so the factory PC (no internet) needs no "npm install".
#
#   bash scripts/make-release.sh 1.4.0          (run from the repo root, on the commit to ship)
#
# Output: digital-kaizen-<version>-offline.zip in the current folder.
set -e
V="$1"; [ -z "$V" ] && { echo "usage: bash scripts/make-release.sh <version>"; exit 1; }
ROOT="$(pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/digital-kaizen"
git archive HEAD | tar -x -C "$TMP/digital-kaizen"
cp -r node_modules "$TMP/digital-kaizen/node_modules"
rm -rf "$TMP/digital-kaizen/design" "$TMP/digital-kaizen/test"
( cd "$TMP/digital-kaizen" && npm prune --omit=dev >/dev/null 2>&1 )
( cd "$TMP" && python3 - "$V" "$ROOT" <<'PY'
import zipfile, os, sys
v, root = sys.argv[1], sys.argv[2]
z = zipfile.ZipFile(os.path.join(root, f'digital-kaizen-{v}-offline.zip'), 'w', zipfile.ZIP_DEFLATED)
for r, d, f in os.walk('digital-kaizen'):
    for n in f:
        p = os.path.join(r, n); z.write(p, p)
z.close()
PY
)
ls -la "digital-kaizen-$V-offline.zip"
