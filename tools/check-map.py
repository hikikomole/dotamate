#!/usr/bin/env python3
"""Сверяет карту функций, сгенерированную внешней моделью, с исходником.

Использование:
    python3 tools/check-map.py js/app.js docs/app-js-map.md

Печатает: сколько функций в исходнике, сколько в карте,
список выдуманных (есть в карте, нет в коде) и пропущенных.
Код возврата 1, если есть выдуманные, — их быть не должно.
"""
import re
import sys

# Ключевые слова JS, которые синтаксически выглядят как вызов функции.
KEYWORDS = {
    'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function',
    'new', 'delete', 'void', 'in', 'of', 'do', 'else', 'try', 'finally',
    'case', 'throw', 'await', 'yield', 'constructor', 'super', 'this',
}

def functions_in_source(code):
    names = set()
    # function foo(...)  /  async function foo(...)
    names |= set(re.findall(r'\bfunction\s+([A-Za-z_$][\w$]*)\s*\(', code))
    # const foo = (...) => / const foo = function / let/var то же самое
    names |= set(re.findall(
        r'\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)',
        code))
    # foo: function(...)  /  foo: (...) =>   — методы объектов
    names |= set(re.findall(
        r'([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>)', code))
    # сокращённая запись метода:  foo(args) {   — только в начале строки с отступом
    names |= set(re.findall(r'^\s{2,}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{', code, re.M))
    return {n for n in names if n not in KEYWORDS}

def functions_in_map(md):
    """Берёт имена только из таблицы в разделе «Функции».

    Раньше сюда попадали строки таблицы глобальных переменных, и валидатор
    объявлял их выдуманными функциями. Ограничиваем разбор нужным разделом.
    """
    names = set()
    in_section = False
    for line in md.splitlines():
        if line.lstrip().startswith('#'):
            in_section = 'функц' in line.lower()
            continue
        if not in_section:
            continue
        if not line.strip().startswith('|'):
            continue
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        if not cells:
            continue
        first = cells[0]
        if not first or set(first) <= set('-: '):
            continue
        # имя может быть в `бэктиках`, со скобками или без
        m = re.search(r'`?([A-Za-z_$][\w$]*)\s*(?:\([^)]*\))?`?', first)
        if m:
            cand = m.group(1)
            if cand not in KEYWORDS and not first.lower().startswith(('функция', 'переменная', 'метод', 'путь')):
                names.add(cand)
    return names

CLASS_TOKEN = '\x00'

def norm_path(p):
    """Приводит путь к виду, где любой параметр — это «*».

    /api/channels/:slug/live      -> /api/channels/*/live
    ^\\/api\\/channels\\/[^/]+\\/live$ -> /api/channels/*/live

    Классы символов вида [^/]+ схлопываются ДО разбиения по «/»,
    иначе слэш внутри класса рвёт путь на куски.
    """
    p = p.strip()
    p = re.sub(r'^\^|\$$', '', p)                       # якоря регулярки
    p = re.sub(r'\[[^\]]*\]', CLASS_TOKEN, p)            # [^/]+, [a-z0-9_] и т.п.
    p = re.sub(r'\\d|\\w|\\S', CLASS_TOKEN, p)          # \d+, \w+
    p = p.replace('\\/', '/')                           # экранированные слэши
    p = p.rstrip('/') or '/'
    out = []
    for seg in p.split('/'):
        if seg and (seg.startswith(':') or CLASS_TOKEN in seg
                    or re.search(r'[(){}+*?|]', seg)):
            out.append('*')
        else:
            out.append(seg)
    return '/'.join(out)

def _usable(path):
    """Отсеивает мусор: разделители таблиц, пустые и бессодержательные пути."""
    if not path.startswith('/'):
        return False
    return any(re.search(r'[a-z]', seg, re.I) for seg in path.split('/'))

def routes_in_source(code):
    """Сервер на голом http-модуле: маршруты сравниваются вручную."""
    paths = set()
    # u.pathname === '/api/health'
    paths |= set(re.findall(r'pathname\s*===?\s*[\'"`]([^\'"`]+)', code))
    # req.url === '/api/...' и req.url.startsWith('/api/webhooks/')
    paths |= set(re.findall(r'\breq\.url\s*(?:===?|\.startsWith\s*\()\s*[\'"`]([^\'"`]+)', code))
    # литералы регулярок: /^\/api\/channels\/[^/]+\/live$/
    paths |= set(re.findall(r'/(\^\\/[^\n]*?\$)/', code))
    out = {norm_path(x) for x in paths}
    return {x for x in out if _usable(x)}

def routes_in_map(md):
    found = re.findall(
        r'`?(?:GET|POST|PUT|PATCH|DELETE|USE|ALL)\s+`?\s*`?(/[^\s`|]*)', md, re.I)
    out = {norm_path(x) for x in found}
    return {x for x in out if _usable(x)}

def report(label, src, mapped):
    invented = sorted(mapped - src)
    missed = sorted(src - mapped)
    print(f'--- {label} ---')
    print(f'  в исходнике: {len(src)}')
    print(f'  в карте:     {len(mapped)}')
    print(f'  выдумано:    {len(invented)}' + (f' -> {invented}' if invented else ''))
    print(f'  пропущено:   {len(missed)}' + (f' -> {missed}' if missed else ''))
    return invented

def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    code = open(sys.argv[1], encoding='utf-8').read()
    md = open(sys.argv[2], encoding='utf-8').read()

    src_fn = functions_in_source(code)
    map_fn = functions_in_map(md)
    invented = report('функции', src_fn, map_fn & (src_fn | map_fn))

    src_rt = routes_in_source(code)
    if src_rt:
        report('маршруты', src_rt, routes_in_map(md))

    return 1 if invented else 0

if __name__ == '__main__':
    sys.exit(main())
