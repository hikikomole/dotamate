#!/usr/bin/env python3
"""Кладёт портреты героев и иконки способностей в assets/ — сайт не ходит за ними на CDN.

Источник: официальный CDN Valve (dota_react/heroes/<slug>.png и
dota_react/abilities/<key>.png). Списки берутся из seo/hero-guide-data.json —
того же файла, по которому собираются гайды и страницы героев.

Повторный запуск дозагружает только недостающее.
"""
import json, os, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CDN = "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react"
UA = {"User-Agent": "Mozilla/5.0 (dotamate build script)"}

def load():
    src = json.load(open(os.path.join(ROOT, "seo", "hero-guide-data.json"), encoding="utf-8"))["heroes"]
    heroes, abilities = set(), set()
    for h in src.values():
        slug = str(h.get("name") or "").replace("npc_dota_hero_", "")
        if slug: heroes.add(slug)
        for a in (h.get("abilities") or []):
            k = a.get("key") or a.get("name")
            if k: abilities.add(k)
    return sorted(heroes), sorted(abilities)

def grab(url, dst):
    if os.path.exists(dst) and os.path.getsize(dst) > 300: return True
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
    except Exception:
        return False
    if len(data) > 300 and data[:4] == b"\x89PNG":
        open(dst, "wb").write(data)
        return True
    return False

def main():
    heroes, abilities = load()
    jobs = [("heroes", heroes), ("abilities", abilities)]
    for kind, keys in jobs:
        dst_dir = os.path.join(ROOT, "assets", kind)
        os.makedirs(dst_dir, exist_ok=True)
        missing = []
        for n, k in enumerate(keys, 1):
            ok = grab(f"{CDN}/{kind}/{k}.png", os.path.join(dst_dir, k + ".png"))
            if not ok: missing.append(k)
            if n % 100 == 0: print(f"  {kind}: {n}/{len(keys)}")
            time.sleep(0.03)
        if kind == "heroes":
            # Внутреннее имя героя у Valve и наш слаг в адресе страницы кое-где
            # расходятся. Адрес не меняем — он уже в поиске, — а кладём копию
            # картинки под тем именем, которое подставляет сайт.
            for valve_name, site_name in (("vengefulspirit", "vengeful_spirit"),):
                src_f = os.path.join(dst_dir, valve_name + ".png")
                dst_f = os.path.join(dst_dir, site_name + ".png")
                if os.path.exists(src_f) and not os.path.exists(dst_f):
                    open(dst_f, "wb").write(open(src_f, "rb").read())
                    print(f"  копия {site_name}.png из {valve_name}.png")
        print(f"{kind}: {len(keys) - len(missing)} из {len(keys)}")
        if missing: print("  не нашлось (%d): %s" % (len(missing), ", ".join(missing[:40])))

if __name__ == "__main__":
    sys.exit(main())
