#!/usr/bin/env python3
"""Забирает официальные русские данные Valve по каждому предмету каталога.

Valve отдаёт datafeed на русском: /datafeed/itemdata?language=russian&item_id=N —
там же лежат и числа (special_values), которыми заполняются %плейсхолдеры%
в описании. Это официальный источник и текста, и цифр одновременно.

Результат: seo/valve-items-ru.json (в деплой не идёт, только исходник сборки).
Запуск повторно — дозагружает только недостающее.
"""
import json, os, re, sys, time, urllib.request

URL = "https://www.dota2.com/datafeed/itemdata?language=russian&item_id=%d"
UA = {"User-Agent": "Mozilla/5.0 (dotamate build script)", "Accept": "application/json"}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "seo", "valve-items-ru.json")

EXCLUDED = set([212,215,287,288,289,290,291,293,294,295,297,298,300,301,302,304,306,307,309,310,311,312,313,325,327,330,334,335,336,349,354,355,356,357,358,360,361,362,363,364,365,366,367,368,369,372,374,375,376,378,379,381,571,573,589,638,676,677,678,680,686,825,828,829,834,835,838,849,939,946,949,990,1000,1028,1029,1030,1090,1124,1156,1157,1158,1159,1160,1161,1167,1440,1441,1576,1577,1581,1583,1584,1585,1586,1587,1588,1589,1590,1591,1592,1593,1594,1595,1596,1597,1600,1602,1607,1608,1610,1639,1641,1645,1647,1648,1649,1650,1651,1652,1801,1803,1849,1850,1865,1866,1867,1869,1870,1871,1874,1875,2091,2092,2093,2094,2095,2096,2192,2193,4300,4301,4302])

def catalog_keys():
    """Тот же отбор, что и isRealCatalogItem() в js/app.js."""
    items = json.load(open(os.path.join(ROOT, "seo", "opendota-items.json"), encoding="utf-8"))
    out = {}
    for k, v in items.items():
        if k in ("courier", "flying_courier", "ward_observer", "ward_sentry"): continue
        if k.startswith("river_painter"): continue
        if not v.get("id") or v["id"] in EXCLUDED: continue
        out[k] = v
    keys = set(out)
    return {k: v for k, v in out.items() if not k.startswith("recipe_") or k[7:] in keys}

def fetch(item_id):
    req = urllib.request.Request(URL % item_id, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        j = json.loads(r.read().decode("utf-8"))
    arr = (((j or {}).get("result") or {}).get("data") or {}).get("items") or []
    return arr[0] if arr else None

def main():
    cat = catalog_keys()
    store = json.load(open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {}
    todo = [(k, v["id"]) for k, v in sorted(cat.items()) if str(v["id"]) not in store]
    print(f"каталог: {len(cat)}, уже есть: {len(store)}, к загрузке: {len(todo)}")
    bad = []
    for n, (key, iid) in enumerate(todo, 1):
        try:
            d = fetch(iid)
        except Exception as e:
            d = None
            print(f"  ! {key} ({iid}): {e}")
        if d:
            store[str(iid)] = d
        else:
            bad.append(key)
        if n % 25 == 0 or n == len(todo):
            json.dump(store, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
            print(f"  {n}/{len(todo)}")
        time.sleep(0.25)
    json.dump(store, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"готово: {len(store)} записей, без ответа: {len(bad)}")
    if bad: print("  " + ", ".join(bad[:30]))

if __name__ == "__main__":
    sys.exit(main())
