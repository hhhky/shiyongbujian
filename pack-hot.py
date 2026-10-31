#!/usr/bin/env python3
"""打包网页热更新包。

用法:
    python pack-hot.py 2      # 生成 hot/web-2.zip

只包含 Web 资源（HTML / CSS / JS / 图标），不含原生代码。
打包后把 zip 传到 web-hot Release，再更新 hot/version.json。
"""
import os
import sys
import zipfile

ROOT_FILES = [
    'index.html',
    'manifest.json',
    'sw.js',
    'icon-180.png',
    'icon-192.png',
    'icon-512.png',
    'icon-maskable-512.png',
]


def main():
    if len(sys.argv) < 2 or not sys.argv[1].strip():
        print('用法: python pack-hot.py <版本号>')
        return 1

    version = sys.argv[1].strip()
    if not os.path.isfile('index.html'):
        print('请在仓库根目录运行本脚本')
        return 1

    os.makedirs('hot', exist_ok=True)
    out = os.path.join('hot', 'web-%s.zip' % version)

    names = list(ROOT_FILES)
    names += ['js/' + f for f in sorted(os.listdir('js')) if f.endswith('.js')]

    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for name in names:
            zf.write(name, name)

    size = os.path.getsize(out) / 1024 / 1024
    print('%s  %.2f MB  共 %d 个文件' % (out, size, len(names)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
