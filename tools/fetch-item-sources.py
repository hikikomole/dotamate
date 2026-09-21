#!/usr/bin/env python3
"""Скачивает исходники для локальной базы предметов в seo/ (в деплой не идут).

Источники:
  * OpenDota constants/items        — id, цена, качество, атрибуты, компоненты;
  * dotabuff/d2vpkr abilities_russian.txt — официальный русский текст Valve.

Сеть нужна только здесь: build-items-ru.py работает уже по этим файлам.
"""
import json, os, sys, urllib.request

SRC = {
    "seo/opendota-items.json": "https://api.opendota.com/api/constants/items",
    "seo/abilities_russian.txt": "https://raw.githubusercontent.com/dotabuff/d2vpkr/master/dota/resource/localization/abilities_russian.txt",
}
UA = {"User-Agent": "Mozilla/5.0 (dotamate build script)"}

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for rel, url in SRC.items():
        dst = os.path.join(root, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
        if rel.endswith(".json"):
            json.loads(data)  # падаем сразу, если пришёл мусор
        with open(dst, "wb") as f:
            f.write(data)
        print(f"{rel}: {len(data)} байт")

if __name__ == "__main__":
    sys.exit(main())
