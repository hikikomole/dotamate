#!/usr/bin/env python3
"""data/heroes.json — снимок списка героев, который сайт грузит первым.

Раньше список героев гонялся наперегонки из трёх внешних источников (Valve
datafeed, OpenDota, зеркало dotaconstants на GitHub). Valve отдаёт без CORS,
то есть из браузера не читается вовсе, а GitHub — лишний внешний адрес ради
данных, которые меняются раз в патч.

Теперь список лежит у нас и рисуется мгновенно, без сети. Живые про-показатели
(pro_pick / pro_win / pro_ban) сайт всё равно догружает из OpenDota поверх
снимка — они меняются ежедневно, и держать их локально смысла нет.
"""
import json, os, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "https://api.opendota.com/api/heroStats"
KEEP = ("id", "name", "localized_name", "primary_attr", "attack_type", "roles", "img",
        "base_health", "base_mana", "base_armor", "base_attack_min", "base_attack_max",
        "move_speed", "base_str", "base_agi", "base_int", "str_gain", "agi_gain", "int_gain",
        "pro_pick", "pro_win", "pro_ban")

def main():
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (dotamate build script)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read().decode("utf-8"))
    out = [{k: h[k] for k in KEEP if k in h} for h in data]
    payload = {"source": "OpenDota heroStats", "count": len(out), "heroes": out}
    for rel in ("data/heroes.json", "deploy/data/heroes.json"):
        dst = os.path.join(ROOT, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        json.dump(payload, open(dst, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print("%s: %d героев, %d КБ" % (rel, len(out), os.path.getsize(dst) // 1024))

if __name__ == "__main__":
    sys.exit(main())
