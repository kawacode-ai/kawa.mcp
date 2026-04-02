#!/bin/bash
set -e

# Deploy @kawacode/mcp to npm
# Usage: ./deploy.sh [patch|minor|major]
#   Defaults to patch if no argument given

BUMP="${1:-patch}"

echo "==> Cleaning build directory"
npm run clean

echo "==> Building TypeScript"
npm run build

echo "==> Bumping version ($BUMP)"
NEW_VERSION=$(npm version "$BUMP" --no-git-tag-version)
echo "    New version: $NEW_VERSION"

# Keep server.json version in sync
node -e "
const fs = require('fs');
const sj = JSON.parse(fs.readFileSync('server.json', 'utf8'));
const pj = JSON.parse(fs.readFileSync('package.json', 'utf8'));
sj.version = pj.version;
sj.packages.forEach(p => p.version = pj.version);
fs.writeFileSync('server.json', JSON.stringify(sj, null, 2) + '\n');
"
echo "    server.json synced to $NEW_VERSION"

echo "==> Publishing to npm"
npm publish --access public

echo "==> Done! Published @kawacode/mcp@$NEW_VERSION"
