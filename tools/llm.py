#!/usr/bin/env python3
"""
Единая обёртка для делегирования рутинных задач бесплатным моделям.
Заменяет прежний gemini.py (чтобы логика не дублировалась в двух файлах).

Смысл: не тратить лимиты Claude на объёмную рутину. Claude ставит задачу,
внешняя модель её выполняет, Claude проверяет результат.

Провайдеры:
  groq   — быстрый (секунды), для механики: классификация, конвертация
           форматов, извлечение JSON, массовые проверки «да/нет».
  gemini — медленнее, но умнее и с большим контекстом: тексты, SEO,
           разбор больших файлов кода.

Ключи берутся из .env в корне проекта (GROQ_API_KEY / GEMINI_API_KEY),
из переменных окружения или из ~/.groq_key / ~/.gemini_key.

Примеры:
    python3 tools/llm.py "перепиши короче"
    python3 tools/llm.py -p gemini -f js/app.js "составь карту функций файла"
    cat index.html | python3 tools/llm.py "найди незакрытые теги"
    python3 tools/llm.py -s "Ты SEO-редактор" -t 0.7 "напиши meta description"
    python3 tools/llm.py -p groq --list     # какие модели живы по ключу

ВАЖНО: любые числовые требования (длина текста, количество пунктов) и
уникальность вывода проверять кодом — обе модели на этом уже ошибались.
"""
import argparse
import json
import os
import pathlib
import stat
import sys
import time
import urllib.error
import urllib.request

KEY_DIR = pathlib.Path("/home/claude")


def load_dotenv() -> dict[str, str]:
    """Читает .env из корня проекта (папка над tools/) и из текущего каталога.

    Файл .env в .gitignore и в репозиторий не попадает — ключи живут только
    на машине разработчика.
    """
    values: dict[str, str] = {}
    candidates = [
        pathlib.Path(__file__).resolve().parent.parent / ".env",
        pathlib.Path.cwd() / ".env",
    ]
    for env_file in candidates:
        if not env_file.is_file():
            continue
        for raw in env_file.read_text(encoding="utf-8", errors="replace").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            values.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    return values

PROVIDERS = {
    "groq": {
        "url": "https://api.groq.com/openai/v1/chat/completions",
        "models_url": "https://api.groq.com/openai/v1/models",
        "env": "GROQ_API_KEY",
        "keyfile": ".groq_key",
        # Сверено со списком реально доступных моделей 18.09.2026:
        # Llama на Groq больше нет, основной рабочий вариант — gpt-oss.
        "default": "openai/gpt-oss-120b",
        # qwen3.8-27b на бесплатном ключе сразу отдаёт 429 — в цепочку не берём.
        "fallbacks": ["openai/gpt-oss-20b", "groq/compound-mini"],
    },
    "gemini": {
        "url": "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        "models_url": "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
        "env": "GEMINI_API_KEY",
        "keyfile": ".gemini_key",
        "default": "gemini-3.6-flash",
        "fallbacks": ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-flash-latest"],
    },
}

RETRY_CODES = (429, 500, 502, 503)
# Cloudflare перед Groq режет дефолтный UA urllib (403, error code 1010).
UA = "curl/8.5.0"


class ApiError(Exception):
    def __init__(self, code: int, detail: str):
        super().__init__(f"HTTP {code}: {detail}")
        self.code = code
        self.detail = detail


def get_key(provider: str) -> str:
    cfg = PROVIDERS[provider]
    key = os.environ.get(cfg["env"], "").strip()
    if key:
        return key
    key = load_dotenv().get(cfg["env"], "").strip()
    if key:
        return key
    for base in (pathlib.Path.home(), KEY_DIR):
        f = base / cfg["keyfile"]
        if f.exists():
            key = f.read_text(encoding="utf-8").strip()
            if key:
                return key
    sys.exit(f"Нет ключа для {provider}: добавьте {cfg['env']}=... "
             f"в .env в корне проекта (см. .env.example)")


def build_request(provider: str, model: str, prompt: str,
                  system: str | None, temperature: float) -> urllib.request.Request:
    cfg = PROVIDERS[provider]
    if provider == "gemini":
        body: dict = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": temperature},
        }
        if system:
            body["systemInstruction"] = {"parts": [{"text": system}]}
        url = cfg["url"].format(model=model)
        headers = {"Content-Type": "application/json", "User-Agent": UA,
                   "x-goog-api-key": get_key(provider)}
    else:  # OpenAI-совместимый формат (groq)
        messages = ([{"role": "system", "content": system}] if system else [])
        messages.append({"role": "user", "content": prompt})
        body = {"model": model, "messages": messages, "temperature": temperature}
        url = cfg["url"]
        headers = {"Content-Type": "application/json", "User-Agent": UA,
                   "Authorization": f"Bearer {get_key(provider)}"}
    return urllib.request.Request(url, data=json.dumps(body).encode("utf-8"),
                                  headers=headers, method="POST")


def extract_text(provider: str, data: dict) -> str:
    if provider == "gemini":
        cand = (data.get("candidates") or [{}])[0]
        parts = cand.get("content", {}).get("parts", [])
        text = "".join(p.get("text", "") for p in parts).strip()
        reason = cand.get("finishReason", "?")
    else:
        choice = (data.get("choices") or [{}])[0]
        text = (choice.get("message", {}).get("content") or "").strip()
        reason = choice.get("finish_reason", "?")
    if not text:
        raise ApiError(0, f"пустой ответ (finish={reason})")
    return text


def call(provider: str, model: str, prompt: str,
         system: str | None, temperature: float) -> str:
    delay = 3
    for attempt in range(1, 4):
        req = build_request(provider, model, prompt, system, temperature)
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                return extract_text(provider, json.load(resp))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:400]
            if e.code in RETRY_CODES and attempt < 3:
                print(f"[retry {attempt}/2] {provider}/{model} HTTP {e.code}, "
                      f"пауза {delay}s", file=sys.stderr)
                time.sleep(delay)
                delay *= 2
                continue
            raise ApiError(e.code, detail)
        except urllib.error.URLError as e:
            raise ApiError(0, f"сеть недоступна: {e.reason}")
    raise ApiError(0, "не удалось получить ответ после 3 попыток")


def list_models(provider: str) -> None:
    cfg = PROVIDERS[provider]
    headers = ({"x-goog-api-key": get_key(provider)} if provider == "gemini"
               else {"Authorization": f"Bearer {get_key(provider)}"})
    headers["User-Agent"] = UA
    req = urllib.request.Request(cfg["models_url"], headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.load(resp)
    except urllib.error.HTTPError as e:
        sys.exit(f"{provider}: HTTP {e.code} {e.read().decode('utf-8','replace')[:300]}")
    if provider == "gemini":
        names = [m["name"].replace("models/", "") for m in data.get("models", [])
                 if "generateContent" in m.get("supportedGenerationMethods", [])]
    else:
        names = [m["id"] for m in data.get("data", [])]
    print("\n".join(sorted(names)))


def read_inputs(args) -> str:
    chunks: list[str] = []
    for path in args.file:
        p = pathlib.Path(path)
        if not p.exists():
            sys.exit(f"Файл не найден: {path}")
        chunks.append(f"--- {p.name} ---\n"
                      f"{p.read_text(encoding='utf-8', errors='replace')}")
    # stdin читаем только если это труба/файл — иначе скрипт зависнет, ожидая EOF.
    try:
        mode = os.fstat(sys.stdin.fileno()).st_mode
        has_stdin = stat.S_ISFIFO(mode) or stat.S_ISREG(mode)
    except OSError:
        has_stdin = False
    if has_stdin:
        piped = sys.stdin.read().strip()
        if piped:
            chunks.append(piped)

    task = " ".join(args.prompt).strip()
    if not task and not chunks:
        sys.exit("Нечего отправлять: дайте текст запроса, --file или stdin")
    return (task + "\n\n" + "\n\n".join(chunks)).strip() if chunks else task


def main() -> None:
    ap = argparse.ArgumentParser(description="Обёртка над бесплатными LLM API")
    ap.add_argument("prompt", nargs="*")
    ap.add_argument("-p", "--provider", choices=list(PROVIDERS), default="groq")
    ap.add_argument("-m", "--model", help="конкретная модель (иначе — дефолт провайдера)")
    ap.add_argument("-s", "--system", help="системная инструкция")
    ap.add_argument("-f", "--file", action="append", default=[])
    ap.add_argument("-t", "--temperature", type=float, default=0.3)
    ap.add_argument("--no-cross", action="store_true",
                    help="не перекидывать на другого провайдера при отказе")
    ap.add_argument("--list", action="store_true", help="показать доступные модели")
    args = ap.parse_args()

    if args.list:
        list_models(args.provider)
        return

    prompt = read_inputs(args)
    cfg = PROVIDERS[args.provider]

    # Цепочка: выбранная модель -> запасные того же провайдера -> другой провайдер.
    chain = [(args.provider, args.model or cfg["default"])]
    chain += [(args.provider, m) for m in cfg["fallbacks"] if m != args.model]
    if not args.no_cross:
        other = "gemini" if args.provider == "groq" else "groq"
        chain.append((other, PROVIDERS[other]["default"]))

    last: ApiError | None = None
    for i, (prov, model) in enumerate(chain):
        try:
            print(call(prov, model, prompt, args.system, args.temperature))
            if i:
                print(f"[использована запасная модель {prov}/{model}]", file=sys.stderr)
            return
        except ApiError as e:
            last = e
            if i + 1 < len(chain):
                nxt = chain[i + 1]
                print(f"[fallback] {prov}/{model} -> {nxt[0]}/{nxt[1]} ({e.code})",
                      file=sys.stderr)
                continue
    sys.exit(f"Все варианты исчерпаны. Последняя ошибка: {last}")


if __name__ == "__main__":
    main()
