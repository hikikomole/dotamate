#!/usr/bin/env python3
"""Кладёт иконки предметов в assets/items/ — сайт больше не ходит за ними на CDN.

Источник: официальный CDN Valve (dota_react/items/<key>.png). Путь берём из
поля img самого предмета, если оно есть, иначе собираем по ключу. Рецептам
своя иконка не нужна: карточка рецепта показывает предмет, который из него
собирается.
"""
import json, os, sys, time, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CDN = "https://cdn.cloudflare.steamstatic.com"
UA = {"User-Agent": "Mozilla/5.0 (dotamate build script)"}
DST = os.path.join(ROOT, "assets", "items")

def load_catalog():
    import importlib.util
    spec = importlib.util.spec_from_file_location("fv", os.path.join(ROOT, "tools", "fetch-valve-items-ru.py"))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m.catalog_keys()

def urls_for(key, rec):
    img = str(rec.get("img") or "")
    out = []
    if img.startswith("/"):
        out.append(CDN + img.split("?")[0])
    out.append(f"{CDN}/apps/dota2/images/dota_react/items/{key}.png")
    return out

def main():
    os.makedirs(DST, exist_ok=True)
    cat = {k: v for k, v in load_catalog().items() if not k.startswith("recipe_")}
    missing, got = [], 0
    for key, rec in sorted(cat.items()):
        dst = os.path.join(DST, key + ".png")
        if os.path.exists(dst) and os.path.getsize(dst) > 300:
            got += 1; continue
        ok = False
        for url in urls_for(key, rec):
            try:
                req = urllib.request.Request(url, headers=UA)
                with urllib.request.urlopen(req, timeout=30) as r:
                    data = r.read()
                if len(data) > 300 and data[:4] == b"\x89PNG":
                    open(dst, "wb").write(data); ok = True; got += 1; break
            except Exception:
                pass
            time.sleep(0.1)
        if not ok: missing.append(key)
        time.sleep(0.05)
    print(f"иконок: {got}, не нашлось: {len(missing)}")
    if missing: print("  " + ", ".join(missing))

if __name__ == "__main__":
    sys.exit(main())
