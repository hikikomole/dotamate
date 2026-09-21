#!/usr/bin/env python3
"""data/item-heroes.json — связь «предмет → герои, которые его покупают».

Считается из seo/hero-guide-data.json (реальные покупки OpenDota по 127 героям,
те же данные, что уже используются в гайдах). Раньше эту связь модалка
предмета тянула из сети по клику; теперь она лежит локально и открывается
мгновенно.
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: os.path.join(ROOT, *p)
PHASES = [("start_game_items", "start"), ("early_game_items", "early"),
          ("mid_game_items", "mid"), ("late_game_items", "late")]
PHASE_RU = {"start": "Старт", "early": "Ранняя", "mid": "Середина", "late": "Поздняя"}

def main():
    src = json.load(open(J("seo", "hero-guide-data.json"), encoding="utf-8"))
    heroes = src.get("heroes") or {}
    items = json.load(open(J("data", "items-ru.json"), encoding="utf-8"))["items"]
    known = {str(v["id"]) for v in items.values()}

    acc = {}          # itemId -> heroId -> {"n":name,"g":games,"ph":{phase:games}}
    for hid, h in heroes.items():
        name = h.get("localized_name") or h.get("name") or ""
        for field, phase in PHASES:
            for iid, games in (h.get("items") or {}).get(field, {}).items():
                if iid not in known: continue
                rec = acc.setdefault(iid, {}).setdefault(str(hid), {"n": name, "g": 0, "ph": {}})
                rec["g"] += int(games)
                rec["ph"][phase] = rec["ph"].get(phase, 0) + int(games)

    out = {}
    for iid, per_hero in acc.items():
        rows = []
        for hid, rec in per_hero.items():
            top = max(rec["ph"].items(), key=lambda x: x[1])[0]
            rows.append({"h": int(hid), "n": rec["n"], "g": rec["g"], "p": PHASE_RU[top]})
        rows.sort(key=lambda r: -r["g"])
        totals = {}
        for rec in per_hero.values():
            for ph, g in rec["ph"].items(): totals[PHASE_RU[ph]] = totals.get(PHASE_RU[ph], 0) + g
        out[iid] = {"heroes": rows[:8], "totals": totals,
                    "games": sum(r["g"] for r in rows), "heroCount": len(rows)}

    # Обратная сторона той же таблицы: что покупает конкретный герой по фазам —
    # это показывает карточка героя.
    per_hero = {}
    for hid, h in heroes.items():
        phases = {}
        for field, phase in PHASES:
            rows = [{"i": int(iid), "g": int(g)}
                    for iid, g in (h.get("items") or {}).get(field, {}).items() if iid in known]
            rows.sort(key=lambda r: -r["g"])
            if rows: phases[phase] = rows[:5]
        if phases: per_hero[str(hid)] = phases

    for rel, payload, what in (
        ("data/item-heroes.json", {"source": "OpenDota itemPopularity, 127 героев", "items": out}, len(out)),
        ("data/hero-items.json", {"source": "OpenDota itemPopularity, 127 героев", "heroes": per_hero}, len(per_hero)),
    ):
        for base in ("", "deploy/"):
            dst = J(base + rel); os.makedirs(os.path.dirname(dst), exist_ok=True)
            json.dump(payload, open(dst, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
            print("%s: %d записей, %d КБ" % (base + rel, what, os.path.getsize(dst) // 1024))

if __name__ == "__main__":
    sys.exit(main())
