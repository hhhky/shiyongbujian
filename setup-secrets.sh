#!/bin/bash
# 在 gh auth login 之后运行此脚本

KEYSTORE="android/app/release.keystore"

if [ ! -f "$KEYSTORE" ]; then
  echo "错误: 找不到 $KEYSTORE"
  echo "请先在 apk-app/android/app/ 目录下生成 release.keystore"
  exit 1
fi

echo "正在 base64 编码 keystore..."
BASE64=$(base64 -w0 "$KEYSTORE")

echo "正在设置 GitHub Secrets..."
echo "$BASE64" | gh secret set KEYSTORE_BASE64
gh secret set KEYSTORE_PASSWORD --body "shiyongbujian2026"
gh secret set KEY_ALIAS        --body "shiyongbujian"
gh secret set KEY_PASSWORD     --body "shiyongbujian2026"

echo "完成! 4 个 Secrets 已配置。"
