#!/usr/bin/env python3
"""Собирает data/items-ru.json — единственный источник данных о предметах на сайте.

Сайт больше никуда не ходит за предметами: ни за описанием, ни за картинкой.
Всё лежит локально и обновляется запуском трёх скриптов подряд:

    python3 tools/fetch-item-sources.py      # OpenDota + локализация Valve
    python3 tools/fetch-valve-items-ru.py    # русский datafeed Valve по каждому предмету
    python3 tools/fetch-item-icons.py        # иконки в assets/items/
    python3 tools/build-items-ru.py          # сборка JSON

Русский текст и числа берутся из официального русского datafeed Valve
(desc_loc / lore_loc / notes_loc / special_values). Плейсхолдеры вида
%spell_reduce% заполняются значениями оттуда же, %% превращается в один
процент. Там, где у Valve текста нет вовсе (базовые предметы магазина, часть
нейтральных), подставляется собственный текст сайта — он помечен флагом own,
чтобы на странице было видно, где Valve, а где мы.
"""
import json, os, re, sys, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: os.path.join(ROOT, *p)

EXCLUDED = set([212,215,287,288,289,290,291,293,294,295,297,298,300,301,302,304,306,307,309,310,311,312,313,325,327,330,334,335,336,349,354,355,356,357,358,360,361,362,363,364,365,366,367,368,369,372,374,375,376,378,379,381,571,573,589,638,676,677,678,680,686,825,828,829,834,835,838,849,939,946,949,990,1000,1028,1029,1030,1090,1124,1156,1157,1158,1159,1160,1161,1167,1440,1441,1576,1577,1581,1583,1584,1585,1586,1587,1588,1589,1590,1591,1592,1593,1594,1595,1596,1597,1600,1602,1607,1608,1610,1639,1641,1645,1647,1648,1649,1650,1651,1652,1801,1803,1849,1850,1865,1866,1867,1869,1870,1871,1874,1875,2091,2092,2093,2094,2095,2096,2192,2193,4300,4301,4302])

# ---------- источники ----------

def load_tokens():
    t = open(J("seo", "abilities_russian.txt"), "rb").read().decode("utf-8-sig", errors="replace")
    pat = re.compile(r'^\s*"([^"]+)"\s+"((?:[^"\\]|\\.)*)"', re.M)
    return {m.group(1).lower(): m.group(2) for m in pat.finditer(t)}

def load_catalog(od):
    out = {}
    for k, v in od.items():
        if k in ("courier", "flying_courier", "ward_observer", "ward_sentry"): continue
        if k.startswith("river_painter"): continue
        if not v.get("id") or v["id"] in EXCLUDED: continue
        out[k] = v
    keys = set(out)
    return {k: v for k, v in out.items() if not k.startswith("recipe_") or k[7:] in keys}

# ---------- текст ----------

def fmt_values(vals):
    if not isinstance(vals, list): vals = [vals]
    out = []
    for v in vals:
        if isinstance(v, float) and v == int(v): v = int(v)
        out.append(str(v))
    seen = []
    for v in out:
        if not seen or seen[-1] != v: seen.append(v)
    return " / ".join(seen if len(set(out)) > 1 else out[:1])

def special_map(d):
    m = {}
    for v in (d.get("special_values") or []):
        vals = v.get("values_float") if isinstance(v.get("values_float"), list) and v.get("values_float") else v.get("values")
        if vals is None: continue
        m[str(v.get("name", "")).lower()] = fmt_values(vals)
    return m

def fill(text, sm, attrib_map):
    def rep(m):
        k = m.group(1).lower()
        if k in sm: return sm[k]
        if k in attrib_map: return attrib_map[k]
        return m.group(0)
    s = re.sub(r"%([a-zA-Z0-9_]+)%", rep, text or "")
    return s.replace("%%", "%")

TAG = re.compile(r"<[^>]+>")

def to_blocks(html):
    """Валвовский HTML -> [{h: заголовок, t: текст}] без сырых тегов."""
    s = html or ""
    s = re.sub(r"<\s*br\s*/?\s*>", "\n", s, flags=re.I)
    s = s.replace("\\n", "\n")
    s = re.sub(r"<\s*h1\s*>", "\x00", s, flags=re.I)
    s = re.sub(r"<\s*/\s*h1\s*>", "\x01", s, flags=re.I)
    s = TAG.sub("", s)
    s = (s.replace("&nbsp;", " ").replace("&amp;", "&")
           .replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"'))
    blocks = []
    # \x00 … \x01 — то, что было <h1>: новый блок с заголовком.
    for chunk in re.split(r"\x00", s):
        head, body = "", chunk
        if "\x01" in chunk:
            head, body = chunk.split("\x01", 1)
        head = head.strip()
        lines = [re.sub(r"[ \t]+", " ", l).strip() for l in body.split("\n")]
        text = "\n".join(l for l in lines if l).strip()
        if head or text: blocks.append({"h": head, "t": text})
    return blocks

def clean_line(s):
    s = re.sub(r"<\s*br\s*/?\s*>", " ", s or "", flags=re.I)
    s = TAG.sub("", s).replace("&nbsp;", " ").replace("&amp;", "&")
    return re.sub(r"\s+", " ", s).strip()

# ---------- атрибуты ----------

def attr_lines(d, variables, od_attr):
    """Строки бонусов: заголовок Valve + официальное число.

    Заголовок приходит в двух видах: с переменной ("+$str") и уже целиком
    по-русски ("+к урону от заклинаний"). В первом случае число подставляется
    вместо переменной, во втором — сразу после знака.
    """
    out = []
    for v in (d.get("special_values") or []):
        head = str(v.get("heading_loc") or "").strip()
        if not head: continue
        vals = v.get("values_float") if isinstance(v.get("values_float"), list) and v.get("values_float") else v.get("values")
        val = fmt_values(vals) if vals else ""
        if not val: val = od_attr.get(str(v.get("name", "")).lower(), "")
        if not val: continue
        if v.get("is_percentage") and not val.endswith("%"): val += "%"
        if "$" in head:
            def rep(m):
                ru = variables.get(m.group(1).lower(), "")
                return (val + " " + ru).strip() if ru else val
            line = re.sub(r"\$([a-zA-Z0-9_]+)", rep, head)
        else:
            m = re.match(r"^([+\-]?)\s*(.*)$", head)
            line = (m.group(1) + val + " " + m.group(2)).strip()
        line = clean_line(line).replace("%%", "%")
        if "$" in line or not line: continue
        out.append(line)
    return out

# ---------- категории ----------

def category(key, od_rec, tier):
    if key.startswith("recipe_"): return "recipe"
    if tier: return "neutral"
    q = str(od_rec.get("qual") or "").lower()
    if q.startswith("consumable"): return "consumable"
    if q == "component": return "component"
    return "item"

CAT_RU = {"item": "Предмет", "component": "Компонент", "consumable": "Расходник",
          "neutral": "Нейтральный", "recipe": "Рецепт"}

# ---------- сборка ----------

def main():
    od = json.load(open(J("seo", "opendota-items.json"), encoding="utf-8"))
    valve = json.load(open(J("seo", "valve-items-ru.json"), encoding="utf-8"))
    toks = load_tokens()
    variables = {k[len("dota_ability_variable_"):]: v for k, v in toks.items()
                 if k.startswith("dota_ability_variable_")}
    own = {}
    p = J("tools", "item-text-own.json")
    if os.path.exists(p): own = json.load(open(p, encoding="utf-8"))

    cat = load_catalog(od)
    built, stats = {}, {"valve_desc": 0, "own_desc": 0, "valve_lore": 0, "own_lore": 0, "no_lore": 0}

    # во что собирается предмет
    into = {}
    for k, v in cat.items():
        for c in set(v.get("components") or []):
            if c: into.setdefault(c, []).append(k)

    # Предмет, которого нет в официальном datafeed Valve, из каталога убираем:
    # OpenDota хранит и то, что из игры давно удалено (например вторая ступень
    # Diffusal Blade). Список выбывших печатается — если он вдруг вырастет,
    # значит упала загрузка, а не вышел патч.
    dropped = [k for k, v in cat.items() if str(v["id"]) not in valve]
    for k in dropped: cat.pop(k)

    for key, rec in sorted(cat.items()):
        iid = int(rec["id"])
        d = valve.get(str(iid)) or {}
        sm = special_map(d)
        attrib_map = {str(a.get("key", "")).lower(): str(a.get("value", ""))
                      for a in (rec.get("attrib") or [])}
        tier_raw = d.get("item_neutral_tier")
        tier = None
        if isinstance(tier_raw, int) and 0 <= tier_raw < 10: tier = tier_raw + 1
        if tier is None and rec.get("tier"): tier = int(rec["tier"])
        c = category(key, rec, tier)

        dname = rec.get("dname") or d.get("name_loc") or key
        cost = int(d.get("item_cost") or rec.get("cost") or 0)

        target = key[7:] if key.startswith("recipe_") else ""
        img_key = target or key

        raw_desc = d.get("desc_loc") or toks.get("dota_tooltip_ability_item_%s_description" % key) or ""
        desc = to_blocks(fill(raw_desc, sm, attrib_map))
        lore = clean_line(d.get("lore_loc") or toks.get("dota_tooltip_ability_item_%s_lore" % key) or "")
        notes = [clean_line(fill(n, sm, attrib_map)) for n in (d.get("notes_loc") or []) if clean_line(n)]
        attrs = attr_lines(d, variables, attrib_map)
        if not attrs:
            for a in (rec.get("attrib") or []):
                disp = a.get("display")
                if disp: attrs.append(clean_line(str(disp).replace("{value}", str(a.get("value", "")))))

        o = own.get(key) or {}
        desc_own = lore_own = False
        if not desc and o.get("desc"):
            desc = [{"h": "", "t": o["desc"]}]; desc_own = True
        if not lore and o.get("lore"):
            lore = o["lore"]; lore_own = True

        stats["valve_desc" if (desc and not desc_own) else "own_desc"] += 1
        if lore and not lore_own: stats["valve_lore"] += 1
        elif lore: stats["own_lore"] += 1
        else: stats["no_lore"] += 1

        built[key] = {
            "id": iid, "dname": dname, "cost": cost, "cat": c, "catRu": CAT_RU[c],
            "img": "/assets/items/%s.png" % img_key,
            "desc": desc, "descOwn": desc_own,
            "lore": lore, "loreOwn": lore_own,
            "notes": notes, "attr": attrs,
            "mc": next((int(x) for x in (d.get("mana_costs") or []) if x), 0),
            "cd": next((int(x) for x in (d.get("cooldowns") or []) if x), 0),
            "comp": [c for c in (rec.get("components") or []) if c],  # повторы в рецепте осмысленны: два одинаковых компонента
            "into": sorted(set(into.get(key, []))),
            "tier": tier, "recipeFor": target,
            "charges": int(d.get("item_initial_charges") or 0),
        }

    # у рецепта нет собственного текста: название и смысл берём от предмета
    for key, it in built.items():
        t = it["recipeFor"]
        if t and t in built:
            it["dname"] = built[t]["dname"] + " — рецепт"
            it["desc"] = [{"h": "", "t": "Рецепт для сборки предмета %s%s." %
                           (built[t]["dname"], (". Стоит %s золота" % it["cost"]) if it["cost"] else "")}]
            it["descOwn"] = True

    out = {
        "generated": datetime.date.today().isoformat(),
        "source": "Valve datafeed (русский) + OpenDota constants/items",
        "count": len(built),
        "items": built,
    }
    for rel in ("data/items-ru.json", "deploy/data/items-ru.json"):
        dst = J(rel); os.makedirs(os.path.dirname(dst), exist_ok=True)
        json.dump(out, open(dst, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print("%s: %d предметов, %d КБ" % (rel, len(built), os.path.getsize(dst) // 1024))
    print(stats)
    if dropped: print("нет в datafeed Valve, исключены (%d): %s" % (len(dropped), ", ".join(sorted(dropped))))
    miss_desc = [k for k, v in built.items() if not v["desc"]]
    miss_lore = [k for k, v in built.items() if not v["lore"]]
    if miss_desc: print("без описания (%d): %s" % (len(miss_desc), ", ".join(miss_desc)))
    if miss_lore: print("без истории (%d): %s" % (len(miss_lore), ", ".join(miss_lore)))

if __name__ == "__main__":
    sys.exit(main())
