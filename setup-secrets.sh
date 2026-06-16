#!/bin/bash
# Run this script after "gh auth login"

BASE64=$(cat android/app/release.keystore.b64)

echo "Setting GitHub secrets..."

echo "$BASE64" | gh secret set KEYSTORE_BASE64

gh secret set KEYSTORE_PASSWORD --body "shiyongbujian2026"
gh secret set KEY_ALIAS --body "shiyongbujian"
gh secret set KEY_PASSWORD --body "shiyongbujian2026"

echo "Done! 4 secrets configured."
echo "Clean up base64 file..."
rm -f android/app/release.keystore.b64
echo "All set."
