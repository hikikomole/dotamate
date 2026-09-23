#!/usr/bin/env python3
"""
Единая обёртка для делегирования рутинных задач бесплатным моделям.
Заменяет прежний gemini.py (чтобы логика не дублировалась в двух файлах).

Смысл: не тратить лимиты Claude на объёмную рутину. Claude ставит задачу,
внешняя модель её выполняет, Claude проверяет результат.

Провайдеры (все с бесплатным тарифом, все — OpenAI-совместимые, кроме gemini):
  groq       — самый быстрый (~1 с), для механики: классификация, конвертация
               форматов, извлечение JSON, массовые проверки «да/нет».
  gemini     — умнее остальных и с большим контекстом: тексты, SEO,
               разбор больших файлов кода. Медленнее.

Ключи берутся из .env в корне проекта, из переменных окружения или из
~/.<provider>_key. Имена переменных — в PROVIDERS ниже, шаблон — в .env.example.

Примеры:
    python3 tools/llm.py "перепиши короче"
    python3 tools/llm.py -p gemini -f js/app.js "составь карту функций файла"
    cat index.html | python3 tools/llm.py "найди незакрытые теги"
    python3 tools/llm.py -s "Ты SEO-редактор" -t 0.7 "напиши meta description"
    python3 tools/llm.py -p groq --list     # какие модели живы по ключу
    python3 tools/llm.py --check            # кто сейчас отвечает, а кто в лимите

ВАЖНО: любые числовые требования (длина текста, количество пунктов) и
уникальность вывода проверять кодом — модели на этом уже ошибались.
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


# kind: как устроен запрос. "openai" — общий формат chat/completions,
# "gemini" — собственный формат Google. Всё остальное различается только URL.
#
# Имена моделей меняются у всех провайдеров без предупреждения. Дефолты ниже —
# отправная точка, а не гарантия: перед объёмной задачей прогоняйте
# `--list` по нужному провайдеру и правьте здесь, если модель пропала.
PROVIDERS = {
    "groq": {
        "kind": "openai",
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
        "kind": "gemini",
        "url": "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        "models_url": "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
        "env": "GEMINI_API_KEY",
        "keyfile": ".gemini_key",
        "default": "gemini-3.6-flash",
        # Pro-модели на бесплатном уровне упираются в 429 почти мгновенно —
        # вся работа идёт на Flash.
        "fallbacks": ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-flash-latest"],
    },
    "ollama": {
        # Локальная модель на машине пользователя: ключа нет, лимитов нет,
        # интернет не нужен. Медленнее облачных и качество зависит от того,
        # какая модель скачана, зато её можно гонять сколько угодно —
        # для массовой механики это главный запасной путь.
        "kind": "openai",
        "url": "http://127.0.0.1:11434/v1/chat/completions",
        "models_url": "http://127.0.0.1:11434/v1/models",
        "env": "OLLAMA_API_KEY",
        "keyfile": ".ollama_key",
        "no_key": True,
        # Пусто — значит «взять первую установленную модель», см. resolve_model.
        "default": "",
        "fallbacks": [],
    },
}

# Порядок перебора, когда выбранный провайдер отказал: сначала быстрые,
# потом умные, потом самые лимитированные. Провайдеры без ключа пропускаются.
PROVIDER_ORDER = ["groq", "gemini", "ollama"]

RETRY_CODES = (429, 500, 502, 503)
# Cloudflare перед Groq режет дефолтный UA urllib (403, error code 1010).
UA = "curl/8.5.0"


class ApiError(Exception):
    def __init__(self, code: int, detail: str):
        super().__init__(f"HTTP {code}: {detail}")
        self.code = code
        self.detail = detail


def find_key(provider: str) -> str | None:
    """Ищет ключ провайдера, но не завершает скрипт, если его нет."""
    cfg = PROVIDERS[provider]
    if cfg.get("no_key"):
        # Локальному серверу ключ не нужен: OpenAI-совместимый путь Ollama
        # требует заголовок Authorization, но его содержимое не проверяет.
        return "local"
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
    return None


def get_key(provider: str) -> str:
    key = find_key(provider)
    if not key:
        sys.exit(f"Нет ключа для {provider}: добавьте {PROVIDERS[provider]['env']}=... "
                 f"в .env в корне проекта (см. .env.example)")
    return key


def get_account(provider: str) -> str:
    """ID аккаунта — нужен только Cloudflare, он стоит прямо в URL."""
    name = PROVIDERS[provider].get("account_env")
    if not name:
        return ""
    value = os.environ.get(name, "").strip() or load_dotenv().get(name, "").strip()
    if not value:
        sys.exit(f"Нет {name} в .env — без ID аккаунта Cloudflare адрес не собрать")
    return value


def provider_url(provider: str, key: str, model: str = "") -> str:
    url = PROVIDERS[provider]["url"]
    if "{account}" in url:
        url = url.replace("{account}", get_account(provider))
    if "{model}" in url:
        url = url.replace("{model}", model)
    return url


def resolve_model(provider: str, model: str) -> str:
    """Пустая модель у ollama значит «первая установленная».

    Список скачанных моделей у каждого свой, зашивать имя в код нельзя.
    """
    if model:
        return model
    cfg = PROVIDERS[provider]
    if provider != "ollama":
        return cfg["default"]
    req = urllib.request.Request(cfg["models_url"],
                                 headers={"User-Agent": UA,
                                          "Authorization": "Bearer local"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            names = sorted(m["id"] for m in json.load(resp).get("data", []))
    except Exception as e:
        raise ApiError(0, f"ollama не отвечает на 127.0.0.1:11434 ({e})")
    if not names:
        raise ApiError(0, "в ollama не скачано ни одной модели (ollama pull ...)")
    return names[0]


def build_request(provider: str, model: str, prompt: str,
                  system: str | None, temperature: float) -> urllib.request.Request:
    cfg = PROVIDERS[provider]
    key = get_key(provider)
    if cfg["kind"] == "gemini":
        body: dict = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": temperature},
        }
        if system:
            body["systemInstruction"] = {"parts": [{"text": system}]}
        headers = {"Content-Type": "application/json", "User-Agent": UA,
                   "x-goog-api-key": key}
    else:  # общий OpenAI-совместимый формат
        messages = ([{"role": "system", "content": system}] if system else [])
        messages.append({"role": "user", "content": prompt})
        body = {"model": model, "messages": messages, "temperature": temperature}
        headers = {"Content-Type": "application/json", "User-Agent": UA,
                   "Authorization": f"Bearer {key}"}
    return urllib.request.Request(provider_url(provider, key, model),
                                  data=json.dumps(body).encode("utf-8"),
                                  headers=headers, method="POST")


def extract_text(provider: str, data: dict) -> str:
    if PROVIDERS[provider]["kind"] == "gemini":
        cand = (data.get("candidates") or [{}])[0]
        parts = cand.get("content", {}).get("parts", [])
        text = "".join(p.get("text", "") for p in parts).strip()
        reason = cand.get("finishReason", "?")
    else:
        choice = (data.get("choices") or [{}])[0]
        msg = choice.get("message", {}) or {}
        text = (msg.get("content") or "").strip()
        # Рассуждающие модели (DeepSeek-R1 и подобные) кладут ответ в content,
        # а ход мысли — отдельно; если content пуст, брать reasoning нельзя,
        # это не ответ. Просто считаем такой результат неудачей.
        reason = choice.get("finish_reason", "?")
    if not text:
        raise ApiError(0, f"пустой ответ (finish={reason})")
    return text


def call(provider: str, model: str, prompt: str,
         system: str | None, temperature: float, timeout: int = 180) -> str:
    model = resolve_model(provider, model)
    delay = 3
    for attempt in range(1, 4):
        req = build_request(provider, model, prompt, system, temperature)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
            try:
                data = json.loads(raw.decode("utf-8", "replace"))
            except ValueError:
                # Провайдер может ответить HTML-страницей ошибки со статусом 200.
                # Без этой ветки json.load роняет весь --check на одном провайдере.
                raise ApiError(0, "ответ не JSON: "
                               + raw[:200].decode("utf-8", "replace").replace("\n", " "))
            return extract_text(provider, data)
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


def model_names(provider: str, data: dict) -> list[str]:
    """Каждый провайдер отдаёт список моделей в своём виде."""
    if PROVIDERS[provider]["kind"] == "gemini":
        return [m["name"].replace("models/", "") for m in data.get("models", [])
                if "generateContent" in m.get("supportedGenerationMethods", [])]
    return [m["id"] for m in data.get("data", [])]


def list_models(provider: str) -> None:
    cfg = PROVIDERS[provider]
    key = get_key(provider)
    headers = ({"x-goog-api-key": key} if cfg["kind"] == "gemini"
               else {"Authorization": f"Bearer {key}"})
    headers["User-Agent"] = UA
    url = cfg["models_url"].replace("{account}", get_account(provider)) \
        if "{account}" in cfg["models_url"] else cfg["models_url"]
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.load(resp)
    except urllib.error.HTTPError as e:
        sys.exit(f"{provider}: HTTP {e.code} {e.read().decode('utf-8','replace')[:300]}")
    names = [n for n in model_names(provider, data) if n]
    print("\n".join(sorted(names)))


def check_all() -> None:
    """Короткий живой опрос всех провайдеров: кто отвечает, кто в лимите.

    Нужен потому, что бесплатные тарифы меняются молча: модель исчезает,
    ключ упирается в суточный лимит, провайдер закрывает регистрацию.
    Дешевле проверить за минуту, чем на середине объёмной задачи.
    """
    for name in PROVIDER_ORDER:
        cfg = PROVIDERS[name]
        if not find_key(name):
            print(f"{name:11} NO KEY   ({cfg['env']})")
            continue
        started = time.time()
        model = cfg["default"]
        try:
            model = resolve_model(name, model)
            text = call(name, model, "Reply with exactly one word: hello",
                        None, 0.0, timeout=60)
            took = time.time() - started
            print(f"{name:11} OK       {took:5.1f}s  {model}")
        except ApiError as e:
            print(f"{name:11} FAIL     HTTP {e.code} {e.detail[:90]}")
        except SystemExit as e:  # нет ID аккаунта и подобное
            print(f"{name:11} NOT SET  {e}")


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


def build_chain(args) -> list[tuple[str, str]]:
    """Выбранная модель -> запасные того же провайдера -> другие провайдеры.

    Провайдеры без ключа в цепочку не попадают: иначе каждый отказ стоил бы
    лишнего круга с заведомо известным результатом.
    """
    cfg = PROVIDERS[args.provider]
    chain = [(args.provider, args.model or cfg["default"])]
    chain += [(args.provider, m) for m in cfg["fallbacks"] if m != args.model]
    if not args.no_cross:
        for name in PROVIDER_ORDER:
            if name == args.provider or not find_key(name):
                continue
            chain.append((name, PROVIDERS[name]["default"]))
    return chain


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
    ap.add_argument("--check", action="store_true",
                    help="опросить всех провайдеров: у кого есть ключ и кто отвечает")
    args = ap.parse_args()

    if args.check:
        check_all()
        return
    if args.list:
        list_models(args.provider)
        return

    prompt = read_inputs(args)
    chain = build_chain(args)

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
