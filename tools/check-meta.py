#!/usr/bin/env python3
"""Проверяет сгенерированные meta description перед сборкой страниц.

    python3 tools/check-meta.py seo/hero-descriptions.json

Что смотрит:
  - длина в диапазоне, который реально показывает выдача;
  - точные дубли (именно из-за них Google склеивает страницы);
  - похожие до неразличимости описания — тот же шаблон с заменой имени;
  - обрывы, многоточия и неразрывные дефисы, которые ломают слаги и вёрстку.

Внешняя модель считает символы на глаз и охотно повторяет одну удачную
формулировку, поэтому длина и уникальность проверяются здесь, а не на слово.
Код возврата 1, если есть хоть одна серьёзная претензия.
"""
import json
import re
import sys
from difflib import SequenceMatcher

MIN_LEN, MAX_LEN = 120, 158
SIMILAR = 0.80          # выше этого пара считается однотипной
BAD_DASHES = '‐‑‒–—−'


def shape(s):
    """Текст без имён собственных и цифр — остаётся «скелет» фразы."""
    s = re.sub(r'\b[A-Z][\w\'-]*', '', s)
    s = re.sub(r'\d+', '', s)
    return re.sub(r'\s+', ' ', s).strip().lower()


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    data = json.load(open(sys.argv[1], encoding='utf-8'))
    hard, soft = [], []

    lengths = []
    for slug, desc in sorted(data.items()):
        n = len(desc)
        lengths.append(n)
        if n < MIN_LEN:
            hard.append(f'{slug}: коротко ({n})')
        if n > MAX_LEN:
            hard.append(f'{slug}: длинно ({n})')
        if '…' in desc or desc.rstrip().endswith(('...', ',', '-', '—')):
            hard.append(f'{slug}: обрыв фразы')
        if any(c in desc for c in BAD_DASHES):
            hard.append(f'{slug}: не тот дефис')
        if not desc[:1].isupper():
            soft.append(f'{slug}: начинается не с заглавной')

    seen = {}
    for slug, desc in sorted(data.items()):
        if desc in seen:
            hard.append(f'{slug}: точный дубль {seen[desc]}')
        seen[desc] = slug

    items = sorted(data.items())
    shapes = {s: shape(d) for s, d in items}
    pairs = 0
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            a, b = items[i][0], items[j][0]
            if SequenceMatcher(None, shapes[a], shapes[b]).ratio() >= SIMILAR:
                pairs += 1
                if pairs <= 10:
                    soft.append(f'однотипные: {a} / {b}')

    print(f'описаний: {len(data)}')
    print(f'длина: мин {min(lengths)}, макс {max(lengths)}, '
          f'средняя {sum(lengths) // len(lengths)} (норма {MIN_LEN}-{MAX_LEN})')
    print(f'точных дублей: {sum(1 for x in hard if "дубль" in x)}')
    print(f'однотипных пар: {pairs}')
    print()
    if hard:
        print(f'ОШИБКИ ({len(hard)}):')
        for x in hard[:30]:
            print('  -', x)
    else:
        print('ошибок нет')
    if soft:
        print(f'\nзамечания ({len(soft)}):')
        for x in soft[:12]:
            print('  -', x)
    return 1 if hard else 0


if __name__ == '__main__':
    sys.exit(main())
