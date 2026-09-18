#!/usr/bin/env python3
"""Генерирует русские meta description для страниц предметов.

Зачем: build-item-pages.js склеивает описание из цены и сырого игрового
текста OpenDota, а тот на английском. На сайте с русским интерфейсом в
выдачу уходит английский абзац, обрезанный по 300 символов на полуслове.

Результат — seo/item-descriptions.json (ключ: слаг страницы). Запускать
можно многократно, готовое пропускается:

    python3 tools/gen-item-meta.py --batches 2 --size 12
    python3 tools/gen-item-meta.py --redo blink black_king_bar

Длину и уникальность проверяет tools/check-meta.py — на слово модели
в этом верить нельзя.
"""
import argparse
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, '.d2h-data-cache-v43', 'const-items.json')
OUT = os.path.join(ROOT, 'seo', 'item-descriptions.json')

MIN_LEN, MAX_LEN = 120, 158

SYSTEM = (
    'Ты пишешь meta description для русскоязычного справочника по Dota 2. '
    'Исходные данные приходят на английском — ты пересказываешь их по-русски, '
    'кратко и по делу, без калек и без машинного перевода. '
    'Названия предметов и способностей оставляешь в оригинальном написании. '
    'Ничего не выдумываешь: чего нет во вводных, того не пишешь. '
    'Отвечаешь строго JSON-объектом без пояснений и markdown-обёртки.'
)


def clean(s):
    return re.sub(r'\s+', ' ', str(s or '')).strip()


def item_facts():
    with open(CACHE, encoding='utf-8') as f:
        data = json.load(f)

    slug_by_name, name_by_slug, known_slugs = {}, {}, set()
    with open(os.path.join(ROOT, 'item-urls.json'), encoding='utf-8') as f:
        for row in json.load(f):
            slug = row['loc'].rstrip('/').rsplit('/', 1)[-1]
            slug_by_name[row['name']] = slug
            name_by_slug[slug] = row['name']
            known_slugs.add(slug)

    out = []
    for key, x in data.items():
        dname = x.get('dname')
        if not dname:
            continue
        # Слаг страницы строится из ключа предмета, а не из отображаемого
        # имени: у Dagon пять уровней, у Necronomicon три, у Diffusal Blade
        # два, и все уровни носят одно имя. Поиск по имени свёл бы их на одну
        # страницу, а остальные остались бы без описания.
        by_key = re.sub(r'[^a-z0-9_]', '_', str(key).replace('item_', '').lower())
        slug = by_key if by_key in known_slugs else slug_by_name.get(dname)
        if not slug:
            continue
        ab = ' '.join(clean(a.get('description')) for a in (x.get('abilities') or []))
        attrs = ', '.join(
            f"{clean(a.get('key')).replace('bonus_', '').replace('_', ' ')} {clean(a.get('value'))}"
            for a in (x.get('attrib') or []) if a.get('value') is not None)
        out.append({
            'slug': slug,
            'name': name_by_slug.get(slug, dname),
            'cost': x.get('cost'),
            'abilities': ab[:600],
            'attrib': attrs[:300],
            'lore': clean(x.get('lore'))[:200],
            'components': len(x.get('components') or []),
        })
    # Несколько ключей OpenDota ведут на одну страницу: у Dagon пять уровней
    # (dagon, dagon_2 ... dagon_5) с одним и тем же dname, у Diffusal Blade —
    # две записи. Без схлопывания по слагу они уходят в запрос по пять раз и
    # возвращаются как дубли.
    uniq = {}
    for x in out:
        prev = uniq.get(x['slug'])
        # оставляем запись с самым содержательным описанием эффекта
        if not prev or len(x['abilities']) > len(prev['abilities']):
            uniq[x['slug']] = x
    return sorted(uniq.values(), key=lambda i: i['slug'])


def fact_line(x):
    # Ключ — слаг, а не имя: Dagon пяти уровней носит одно имя, и в JSON-ответе
    # такие записи перетирают друг друга, оставляя четыре страницы без описания.
    bits = [f"[{x['slug']}] {x['name']}"]
    if x['cost']:
        bits.append(f"цена {x['cost']}")
    if x['attrib']:
        bits.append(f"бонусы: {x['attrib']}")
    if x['abilities']:
        bits.append(f"эффект: {x['abilities']}")
    elif x['lore']:
        bits.append(f"лор: {x['lore']}")
    if x['components']:
        bits.append(f"собирается из {x['components']} компонентов")
    return ' | '.join(bits)


def ask(batch):
    facts = '\n\n'.join(fact_line(x) for x in batch)
    keys = ', '.join(x['slug'] for x in batch)
    prompt = f"""Напиши русские meta description для страниц этих предметов Dota 2.

{facts}

Требования к каждому описанию:
- длина строго от {MIN_LEN} до {MAX_LEN} символов, считая пробелы и знаки препинания;
- начинается с названия предмета ровно в том написании, что дано выше;
- по-русски, но название предмета и названия способностей не переводятся;
- называет главный эффект своими словами, а не пересказывает англоязычный текст дословно;
- если известна цена, упоминает её;
- заканчивается тем, что есть на странице: характеристики, компоненты сборки, описание (формулируй по-разному);
- никаких многоточий, обрывов и незаконченных предложений;
- обычный дефис-минус, никаких длинных тире;
- описания должны заметно отличаться друг от друга по структуре.

Ответ — JSON-объект, где ключ это идентификатор в квадратных скобках ({keys}), значение это описание. Название предмета в квадратных скобках не повторяй — оно идёт сразу после них. Без markdown, без пояснений."""

    r = subprocess.run(
        [sys.executable, os.path.join(ROOT, 'tools', 'llm.py'),
         '-p', 'gemini', '-s', SYSTEM, prompt],
        capture_output=True, text=True, timeout=200, cwd=ROOT)
    if r.returncode != 0:
        print('  ! llm.py вернул', r.returncode, r.stderr.strip()[:200])
        return {}
    text = re.sub(r'^```(?:json)?|```$', '', r.stdout.strip(), flags=re.M).strip()
    m = re.search(r'\{.*\}', text, re.S)
    if not m:
        print('  ! ответ без JSON:', text[:160])
        return {}
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError as e:
        print('  ! JSON не разобран:', e)
        return {}


def problems(desc, item, others):
    if not isinstance(desc, str) or not desc.strip():
        return ['пусто']
    d = desc.strip()
    bad = []
    if len(d) < MIN_LEN:
        bad.append(f'коротко ({len(d)})')
    if len(d) > MAX_LEN:
        bad.append(f'длинно ({len(d)})')
    if item['name'].lower() not in d.lower():
        bad.append('нет названия предмета')
    if '…' in d or d.endswith(('...', ',', '-')):
        bad.append('обрыв')
    if re.search(r'[‐‑‒–—−]', d):
        bad.append('не тот дефис')
    # текст должен быть русским, а не пересказанным английским
    if len(re.findall(r'[а-яё]', d, re.I)) < len(re.findall(r'[a-z]', d, re.I)):
        bad.append('текст не по-русски')
    if d in others:
        bad.append('дубль')
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--batches', type=int, default=2)
    ap.add_argument('--size', type=int, default=12)
    ap.add_argument('--redo', nargs='*', default=[])
    args = ap.parse_args()

    done = {}
    if os.path.exists(OUT):
        with open(OUT, encoding='utf-8') as f:
            done = json.load(f)
    for slug in args.redo:
        done.pop(slug, None)

    items = item_facts()
    todo = [x for x in items if x['slug'] not in done]
    print(f'всего предметов: {len(items)}, готово: {len(done)}, в очереди: {len(todo)}')

    processed = 0
    for i in range(0, len(todo), args.size):
        if processed >= args.batches:
            break
        batch = todo[i:i + args.size]
        processed += 1
        print(f'пачка {processed}: ' + ', '.join(x['name'] for x in batch))
        got = ask(batch)
        for x in batch:
            desc = got.get(x['slug']) or got.get(x['name'])
            bad = problems(desc, x, set(done.values()))
            if bad:
                print(f"  - {x['name']}: {', '.join(bad)}")
                continue
            done[x['slug']] = desc.strip()
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, 'w', encoding='utf-8') as f:
            json.dump(done, f, ensure_ascii=False, indent=1, sort_keys=True)

    left = [x for x in items if x['slug'] not in done]
    print(f'готово: {len(done)}/{len(items)}, осталось: {len(left)}')


if __name__ == '__main__':
    main()
