#!/usr/bin/env python3
"""Генерирует уникальные meta description для страниц героев.

Зачем: build-hero-pages.js подставляет всем 127 героям один и тот же
шаблон, меняя только имя и список ролей. Google склеивает такие дубли,
и страницы конкурируют сами с собой.

Скрипт складывает результат в seo/hero-descriptions.json (ключ — слаг
страницы). Запускать можно многократно: уже готовые и прошедшие проверку
описания пропускаются, так что работа продолжается с места обрыва.

    python3 tools/gen-hero-meta.py            # 4 пачки за запуск
    python3 tools/gen-hero-meta.py --batches 8
    python3 tools/gen-hero-meta.py --redo Axe # перегенерировать конкретных

Длина и уникальность проверяются здесь же: модель считает символы плохо,
верить ей на слово нельзя.
"""
import argparse
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, '.d2h-data-cache-v43')
OUT = os.path.join(ROOT, 'seo', 'hero-descriptions.json')

MIN_LEN, MAX_LEN = 120, 158
BATCH = 8

RU_ROLES = {
    'Carry': 'керри', 'Support': 'саппорт', 'Nuker': 'нюкер',
    'Disabler': 'дизейблер', 'Jungler': 'джанглер', 'Durable': 'танк',
    'Escape': 'побег', 'Pusher': 'пушер', 'Initiator': 'инициатор',
}
RU_ATTR = {'str': 'силы', 'agi': 'ловкости', 'int': 'интеллекта', 'all': 'универсал'}
RU_ATTACK = {'Melee': 'ближний бой', 'Ranged': 'дальний бой'}
COMPLEXITY = {1: 'простой', 2: 'средней сложности', 3: 'сложный'}

SYSTEM = (
    'Ты пишешь meta description для страниц справочника по Dota 2 на русском языке. '
    'Пишешь живо и конкретно, опираясь только на переданные факты. '
    'Ничего не выдумываешь: если факта нет во вводных, не упоминаешь его. '
    'Отвечаешь строго JSON-объектом без пояснений и без markdown-обёртки.'
)


def load(name):
    with open(os.path.join(CACHE, name), encoding='utf-8') as f:
        d = json.load(f)
    return d.get('data', d)


def hero_facts():
    heroes = load('heroes.json')
    hero_ab = load('const-hero-abilities.json')
    abilities = load('const-abilities.json')

    # Слаг страницы берём из hero-urls.json — он авторитетный, его пишет
    # сам генератор страниц. Имена в кэше и в urls местами расходятся
    # (Outworld Destroyer / Outworld Devourer, Ringmaster / Ring Master),
    # поэтому если по имени не нашлось, слаг выводим из внутреннего
    # npc_dota_hero_* и проверяем, что такая страница вообще есть.
    slug_by_name, known_slugs, name_by_slug = {}, set(), {}
    with open(os.path.join(ROOT, 'hero-urls.json'), encoding='utf-8') as f:
        for row in json.load(f):
            slug = row['loc'].rstrip('/').rsplit('/', 1)[-1]
            slug_by_name[row['name']] = slug
            name_by_slug[slug] = row['name']
            known_slugs.add(slug)

    out = []
    for h in heroes:
        name = h['localized_name']
        slug = slug_by_name.get(name)
        if not slug:
            derived = re.sub(r'^npc_dota_hero_', '', h.get('name', ''))
            slug = derived if derived in known_slugs else None
        if not slug:
            print(f'! нет страницы для героя {name}, пропущен')
            continue
        spells = []
        # у Monkey King внутри abilities лежит вложенный список (формы),
        # поэтому список раскладывается в плоский перед разбором
        raw_ab = (hero_ab.get(h['name'], {}) or {}).get('abilities', [])
        flat_ab = []
        for a in raw_ab:
            flat_ab.extend(a if isinstance(a, list) else [a])
        for key in flat_ab:
            if not isinstance(key, str):
                continue
            if key.startswith('generic') or key.endswith('_empty'):
                continue
            dname = (abilities.get(key) or {}).get('dname')
            if dname:
                spells.append(dname)
        # Имя берём из hero-urls.json: его пишет генератор страниц по живым
        # данным, а в кэше имя может быть старым (Outworld Destroyer против
        # Outworld Devourer). Описание должно начинаться ровно тем именем,
        # которое окажется на странице, иначе сборка откатится на шаблон.
        name = name_by_slug.get(slug, name)
        roles = [RU_ROLES.get(r, r.lower()) for r in h.get('roles', [])]
        winrate = None
        if h.get('pub_pick') and h.get('pub_win'):
            winrate = round(100 * h['pub_win'] / h['pub_pick'], 1)
        out.append({
            'slug': slug,
            'name': name,
            'attr': RU_ATTR.get(h.get('primary_attr'), ''),
            'attack': RU_ATTACK.get(h.get('attack_type'), ''),
            'roles': roles,
            'complexity': COMPLEXITY.get(h.get('complexity'), ''),
            'spells': spells[:4],
            'winrate': winrate,
        })
    return out


def fact_line(h):
    bits = [f"{h['name']}"]
    if h['attr'] == 'универсал':
        bits.append('универсал')
    elif h['attr']:
        bits.append(f"герой {h['attr']}")
    if h['attack']:
        bits.append(h['attack'])
    if h['roles']:
        bits.append('роли: ' + ', '.join(h['roles']))
    if h['complexity']:
        bits.append(h['complexity'])
    if h['spells']:
        bits.append('способности: ' + ', '.join(h['spells']))
    return ' | '.join(bits)


def ask(batch):
    facts = '\n'.join(fact_line(h) for h in batch)
    names = ', '.join(h['name'] for h in batch)
    prompt = f"""Напиши meta description для страниц этих героев Dota 2.

{facts}

Требования к каждому описанию:
- длина строго от {MIN_LEN} до {MAX_LEN} символов, считая пробелы и знаки препинания;
- начинается с имени героя ровно в том написании, что дано выше;
- называет роль и одну-две конкретные способности или особенность именно этого героя;
- заканчивается тем, что есть на странице: характеристики, билд, контрпики (формулируй по-разному, не одной и той же фразой);
- никаких многоточий, обрывов и незаконченных предложений;
- обычный дефис-минус, никаких длинных тире и неразрывных дефисов;
- описания должны заметно отличаться друг от друга по структуре, а не только именем.

Ответ — JSON-объект, где ключ это имя героя ({names}), значение это описание. Без markdown, без пояснений."""

    r = subprocess.run(
        [sys.executable, os.path.join(ROOT, 'tools', 'llm.py'),
         '-p', 'gemini', '-s', SYSTEM, prompt],
        capture_output=True, text=True, timeout=180, cwd=ROOT)
    if r.returncode != 0:
        print('  ! llm.py вернул', r.returncode, r.stderr.strip()[:200])
        return {}
    text = r.stdout.strip()
    text = re.sub(r'^```(?:json)?|```$', '', text, flags=re.M).strip()
    m = re.search(r'\{.*\}', text, re.S)
    if not m:
        print('  ! ответ без JSON:', text[:160])
        return {}
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError as e:
        print('  ! JSON не разобран:', e)
        return {}


def problems(desc, hero, others):
    """Возвращает список претензий к описанию. Пусто — описание годное."""
    bad = []
    if not isinstance(desc, str) or not desc.strip():
        return ['пусто']
    d = desc.strip()
    if len(d) < MIN_LEN:
        bad.append(f'коротко ({len(d)})')
    if len(d) > MAX_LEN:
        bad.append(f'длинно ({len(d)})')
    if hero['name'].lower() not in d.lower():
        bad.append('нет имени героя')
    if '…' in d or d.endswith(('...', ',', '-')):
        bad.append('обрыв')
    if re.search(r'[‐‑‒–—−]', d):
        bad.append('не тот дефис')
    if d in others:
        bad.append('дубль')
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--batches', type=int, default=4, help='сколько пачек за запуск')
    ap.add_argument('--size', type=int, default=BATCH, help='героев в пачке')
    ap.add_argument('--redo', nargs='*', default=[], help='имена героев для перегенерации')
    args = ap.parse_args()

    done = {}
    if os.path.exists(OUT):
        with open(OUT, encoding='utf-8') as f:
            done = json.load(f)

    heroes = hero_facts()
    by_slug = {h['slug']: h for h in heroes}
    for name in args.redo:
        for h in heroes:
            if h['name'].lower() == name.lower():
                done.pop(h['slug'], None)

    todo = [h for h in heroes if h['slug'] not in done]
    print(f'всего героев: {len(heroes)}, готово: {len(done)}, в очереди: {len(todo)}')

    processed = 0
    for i in range(0, len(todo), args.size):
        if processed >= args.batches:
            break
        batch = todo[i:i + args.size]
        processed += 1
        print(f'пачка {processed}: ' + ', '.join(h['name'] for h in batch))
        got = ask(batch)
        for h in batch:
            desc = got.get(h['name']) or got.get(h['slug'])
            bad = problems(desc, h, set(done.values()))
            if bad:
                print(f"  - {h['name']}: {', '.join(bad)}")
                continue
            done[h['slug']] = desc.strip()
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, 'w', encoding='utf-8') as f:
            json.dump(done, f, ensure_ascii=False, indent=1, sort_keys=True)

    left = [h for h in heroes if h['slug'] not in done]
    print(f'готово: {len(done)}/{len(heroes)}, осталось: {len(left)}')
    if left and processed >= args.batches:
        print('запусти скрипт ещё раз, чтобы продолжить')


if __name__ == '__main__':
    main()
