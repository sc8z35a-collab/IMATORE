#!/usr/bin/env bash
# Build and publish dist/ to the gh-pages branch (GitHub Pages source).
#   bash tools/deploy_pages.sh
# Serving the raw repo root (source files) does NOT work: index.html references /src/main.js,
# which imports the bare module 'three' — only the Vite build output is deployable.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
touch dist/.nojekyll
REV=$(git rev-parse --short HEAD)
TMP=$(mktemp -d)
cp -r dist/. "$TMP"/
cd "$TMP"
git init -q -b gh-pages
git add -A
git -c user.name="${GIT_AUTHOR_NAME:-deploy}" -c user.email="${GIT_AUTHOR_EMAIL:-deploy@localhost}" commit -qm "deploy: build of $REV"
git push -qf "$(cd - >/dev/null && git remote get-url origin)" gh-pages
echo "published $REV to gh-pages"
