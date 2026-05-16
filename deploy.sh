#!/bin/bash
set -e

# Deploy @kawacode/mcp to npm + MCP Registry
# Usage:
#   ./deploy.sh [patch|minor|major]   — bump version then publish (default: patch)
#   ./deploy.sh --no-bump             — publish the existing package.json version
#                                        (use when the version was already bumped
#                                        in a prior commit, e.g. a semver-breaking
#                                        change committed alongside the work)

ARG="${1:-patch}"
DOMAIN="kawacode.ai"
KEY_FILE="mcp-registry-key.pem"

case "$ARG" in
  patch|minor|major|--no-bump) ;;
  *)
    echo "ERROR: unknown argument '$ARG'. Expected patch | minor | major | --no-bump." >&2
    exit 1
    ;;
esac

# Prerequisites
if [ ! -f "$KEY_FILE" ]; then
  echo "ERROR: $KEY_FILE not found. Recover from a backup — do not regenerate." >&2
  exit 1
fi
if ! command -v mcp-publisher >/dev/null 2>&1; then
  echo "ERROR: mcp-publisher not installed. Install with: brew install mcp-publisher" >&2
  exit 1
fi

echo "==> Cleaning build directory"
npm run clean

echo "==> Building TypeScript"
npm run build

if [ "$ARG" = "--no-bump" ]; then
  NEW_VERSION="v$(node -e "process.stdout.write(require('./package.json').version)")"
  echo "==> Using existing version $NEW_VERSION (--no-bump)"
else
  echo "==> Bumping version ($ARG)"
  NEW_VERSION=$(npm version "$ARG" --no-git-tag-version)
  echo "    New version: $NEW_VERSION"
fi

# Keep server.json version in sync. Runs unconditionally so an existing drift
# (e.g. someone bumped package.json by hand and forgot server.json) is healed
# before we publish to the registry, which would reject a mismatch.
node -e "
const fs = require('fs');
const sj = JSON.parse(fs.readFileSync('server.json', 'utf8'));
const pj = JSON.parse(fs.readFileSync('package.json', 'utf8'));
sj.version = pj.version;
sj.packages.forEach(p => p.version = pj.version);
fs.writeFileSync('server.json', JSON.stringify(sj, null, 2) + '\n');
"
echo "    server.json synced to $NEW_VERSION"

echo "==> Validating server.json against MCP Registry schema"
mcp-publisher validate

echo "==> Publishing to npm"
npm publish --access public

echo "==> Authenticating with MCP Registry (DNS, $DOMAIN)"
PRIVATE_KEY_HEX=$(openssl pkey -in "$KEY_FILE" -outform DER | tail -c 32 | xxd -p -c 64)
mcp-publisher login dns --domain "$DOMAIN" --private-key "$PRIVATE_KEY_HEX" --algorithm ed25519

echo "==> Publishing to MCP Registry"
mcp-publisher publish

echo "==> Done! Published @kawacode/mcp@$NEW_VERSION to npm + MCP Registry"
