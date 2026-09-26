<?php
// /api/* для dotamate.ru на хостинге Hostiman (с 26.09.2026 вместо Cloudflare Worker).
// Контракт ответов тот же, что был у deploy/worker.js: фронтенд не меняется.
// Кеш и база лежат ВНЕ корня сайта (~/dotamate-data): выкладка подменяет корень целиком.

declare(strict_types=1);

const OPENDOTA = 'https://api.opendota.com/api';
const VDF_RU_URL = 'https://raw.githubusercontent.com/dotabuff/d2vpkr/master/dota/resource/localization/abilities_russian.txt';
const FEEDBACK_TOPICS = ['question', 'bug', 'personal_data', 'other'];
const FEEDBACK_ORIGINS = ['https://dotamate.ru', 'https://www.dotamate.ru'];

function webroot(): string { return dirname(__DIR__); }
function dataDir(): string {
  $d = dirname(webroot(), 2) . '/dotamate-data';           // ~/www/dotamate.ru -> ~/dotamate-data
  if (!is_dir($d)) @mkdir($d, 0700, true);
  if (!is_dir($d . '/cache')) @mkdir($d . '/cache', 0700, true);
  return $d;
}

function send($data, int $status = 200): void {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

function httpGet(string $url, int $timeout = 5, string $accept = 'application/json'): string {
  $ctx = stream_context_create(['http' => [
    'timeout' => $timeout, 'ignore_errors' => true,
    'header' => "Accept: $accept\r\nUser-Agent: dotamate.ru\r\n",
  ]]);
  $last = null;
  for ($attempt = 0; $attempt < 2; $attempt++) {
    $body = @file_get_contents($url, false, $ctx);
    $code = 0;
    foreach ($http_response_header ?? [] as $h) if (preg_match('#^HTTP/\S+\s+(\d+)#', $h, $m)) $code = (int)$m[1];
    if ($body !== false && $code >= 200 && $code < 300) return $body;
    $last = "HTTP $code for $url";
    if ($code && $code !== 429 && $code < 500) break;       // настоящие ошибки клиента не повторяем
    usleep(400000);
  }
  throw new RuntimeException($last ?? "fetch failed: $url");
}
function getJson(string $url, int $timeout = 5) {
  $j = json_decode(httpGet($url, $timeout), true);
  if ($j === null) throw new RuntimeException("bad json: $url");
  return $j;
}

// Файловый кеш с отрицательным кешем на 10 минут (как в воркере): упавший апстрим
// не заставляет каждого следующего посетителя ждать тот же таймаут.
function cached(string $key, int $ttl, callable $fetch) {
  $f = dataDir() . '/cache/' . preg_replace('/[^a-z0-9_.-]/i', '_', $key) . '.json';
  if (is_file($f) && time() - filemtime($f) < $ttl) {
    $v = json_decode((string)file_get_contents($f), true);
    if ($v !== null) return $v;
  }
  $fail = $f . '.fail';
  if (is_file($fail) && time() - filemtime($fail) < 600) {
    if (is_file($f)) { $v = json_decode((string)file_get_contents($f), true); if ($v !== null) return $v; }
    throw new RuntimeException("upstream recently failed: $key");
  }
  try {
    $v = $fetch();
    file_put_contents($f . '.tmp', json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
    rename($f . '.tmp', $f);
    @unlink($fail);
    return $v;
  } catch (Throwable $e) {
    @touch($fail);
    if (is_file($f)) { $v = json_decode((string)file_get_contents($f), true); if ($v !== null) return $v; } // устаревшее лучше пустого
    throw $e;
  }
}

function staticJson(string $path) {
  $f = webroot() . $path;
  if (!is_file($f)) throw new RuntimeException("static asset $path missing");
  $v = json_decode((string)file_get_contents($f), true);
  if ($v === null) throw new RuntimeException("static asset $path bad json");
  return $v;
}

// --- Официальный русский текст Valve (тот же источник и та же логика, что в воркере) ---
function ruMap(): array {
  static $memo = null;
  if ($memo !== null) return $memo;
  return $memo = cached('vdf-ru-v1', 86400, function () {
    $text = httpGet(VDF_RU_URL, 10, 'text/plain');
    if (strncmp($text, "\xEF\xBB\xBF", 3) === 0) $text = substr($text, 3);
    $map = [];
    foreach (preg_split('/\r?\n/', $text) as $line) {
      $line = trim($line);
      if ($line === '' || strncmp($line, '//', 2) === 0) continue;
      if (preg_match('/^"((?:[^"\\\\]|\\\\.)*)"\s*"((?:[^"\\\\]|\\\\.)*)"/', $line, $m)) {
        $k = mb_strtolower($m[1]);
        if (strpos($k, 'dota_tooltip_ability_') === 0 && substr($k, -12) === '_description') $map[$k] = str_replace('\\"', '"', $m[2]);
      }
    }
    if (!$map) throw new RuntimeException('VDF parsed empty');
    return $map;
  });
}
function resolveRuText(string $key, bool $isItem, $attrib): array {
  $none = ['text' => '', 'source' => 'none'];
  try {
    $map = ruMap();
    $tk = mb_strtolower('DOTA_Tooltip_ability_' . ($isItem ? 'item_' : '') . $key . '_Description');
    if (!isset($map[$tk])) return $none;
    $vals = [];
    foreach ((array)$attrib as $a) {
      if (!is_array($a) || empty($a['key'])) continue;
      $v = $a['value'] ?? ''; if (is_array($v)) $v = implode('/', $v);
      $vals[mb_strtolower((string)$a['key'])] = (string)$v;
    }
    $text = preg_replace_callback('/%([a-zA-Z0-9_]+)%/', fn($m) => $vals[mb_strtolower($m[1])] ?? $m[0], $map[$tk]);
    if (preg_match('/%[a-zA-Z0-9_]+%/', $text)) return $none;
    return ['text' => $text, 'source' => 'official-ru'];
  } catch (Throwable $e) { return $none; }
}

function constantsMap(string $name, string $fallback) {
  try { return cached("const-$name-v1", 86400, fn() => getJson(OPENDOTA . "/constants/$name")); }
  catch (Throwable $e) { return staticJson($fallback); }
}

function heroAbilities(string $hero): array {
  return cached("hero-abilities-$hero", 86400, function () use ($hero) {
    $heroes = constantsMap('hero_abilities', '/data/hero_abilities.json');
    $abil = constantsMap('abilities', '/data/abilities.json');
    $entry = $heroes[$hero] ?? null;
    if (!$entry || !is_array($entry['abilities'] ?? null)) return [];
    $keys = array_slice(array_values(array_filter($entry['abilities'], fn($k) => $k && $k !== 'generic_hidden')), 0, 6);
    $out = [];
    foreach ($keys as $k) {
      $a = $abil[$k] ?? null; if (!$a) continue;
      $r = resolveRuText($k, false, $a['attrib'] ?? []);
      $out[] = ['key' => $k, 'dname' => $a['dname'] ?? $k, 'desc' => $r['text'], 'source' => $r['source'], 'behavior' => $a['behavior'] ?? ''];
    }
    return $out;
  });
}

function heroStats() {
  try { return cached('hero-stats-v1', 86400, fn() => getJson(OPENDOTA . '/heroStats')); }
  catch (Throwable $e) { $l = staticJson('/data/heroes.json'); return $l['heroes'] ?? []; }
}

// --- Обратная связь: SQLite вне корня сайта, те же проверки, что в воркере ---
function feedbackDb(): PDO {
  $db = new PDO('sqlite:' . dataDir() . '/feedback.sqlite');
  $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
  $db->exec('CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, topic TEXT NOT NULL, name TEXT, contact TEXT, message TEXT NOT NULL, ip_hash TEXT, status TEXT NOT NULL DEFAULT \'new\')');
  $db->exec('CREATE INDEX IF NOT EXISTS feedback_created ON feedback(created_at)');
  return $db;
}
function cleanText($v, int $max): string {
  if (!is_string($v)) return '';
  return mb_substr(trim(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $v) ?? ''), 0, $max);
}
function handleFeedback(): void {
  if ($_SERVER['REQUEST_METHOD'] !== 'POST') send(['error' => 'method_not_allowed'], 405);
  if (!in_array($_SERVER['HTTP_ORIGIN'] ?? '', FEEDBACK_ORIGINS, true)) send(['error' => 'forbidden'], 403);
  if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 20000) send(['error' => 'too_large'], 413);
  $body = json_decode((string)file_get_contents('php://input', false, null, 0, 20001), true);
  if (!is_array($body)) send(['error' => 'bad_json'], 400);

  // Бот: скрытое поле заполнено или форма отправлена быстрее 3 с — «успех» без записи.
  $elapsed = (int)floor(microtime(true) * 1000) - (int)($body['t'] ?? 0);
  if (!empty($body['website']) || $elapsed < 3000) send(['ok' => true]);

  $topic = in_array($body['topic'] ?? '', FEEDBACK_TOPICS, true) ? $body['topic'] : '';
  $name = cleanText($body['name'] ?? '', 100);
  $contact = cleanText($body['contact'] ?? '', 200);
  $message = cleanText($body['message'] ?? '', 4000);
  if ($topic === '') send(['error' => 'bad_topic'], 400);
  if (mb_strlen($message) < 10) send(['error' => 'short_message'], 400);
  if (($body['consent'] ?? null) !== true) send(['error' => 'no_consent'], 400);

  $now = (int)floor(microtime(true) * 1000);
  $ip = $_SERVER['REMOTE_ADDR'] ?? '';
  $ipHash = $ip !== '' ? hash('sha256', 'dotamate-feedback:' . $ip) : null;
  $db = feedbackDb();
  if ($ipHash) {
    $q = $db->prepare('SELECT COUNT(*) FROM feedback WHERE ip_hash = ? AND created_at > ?');
    $q->execute([$ipHash, $now - 3600000]);
    if ((int)$q->fetchColumn() >= 3) send(['error' => 'rate_limited'], 429);
  }
  $q = $db->prepare('SELECT COUNT(*) FROM feedback WHERE created_at > ?');
  $q->execute([$now - 86400000]);
  if ((int)$q->fetchColumn() >= 200) send(['error' => 'rate_limited'], 429);

  $db->beginTransaction();
  $db->prepare('INSERT INTO feedback (created_at, topic, name, contact, message, ip_hash) VALUES (?, ?, ?, ?, ?, ?)')
     ->execute([$now, $topic, $name ?: null, $contact ?: null, $message, $ipHash]);
  $db->prepare('UPDATE feedback SET ip_hash = NULL WHERE ip_hash IS NOT NULL AND created_at < ?')->execute([$now - 30 * 86400000]);
  $db->commit();
  send(['ok' => true]);
}

// --- Маршруты ---
try {
  $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
  if ($path === '/api/feedback') handleFeedback();
  if (strpos($path, '/api/dota/') !== 0) send(['error' => 'not_found'], 404);
  if ($_SERVER['REQUEST_METHOD'] !== 'GET') send(['error' => 'method_not_allowed'], 405);

  if (preg_match('#^/api/dota/hero/(\d+)/items$#', $path, $m)) {
    try { send(cached('hero-items-' . $m[1], 43200, fn() => getJson(OPENDOTA . '/heroes/' . $m[1] . '/itemPopularity'))); }
    catch (Throwable $e) { send(['error' => 'hero_items_unavailable', 'message' => $e->getMessage()], 502); }
  }
  if (preg_match('#^/api/dota/hero/([a-zA-Z0-9_]+)/abilities$#', $path, $m)) {
    try { send(heroAbilities($m[1])); }
    catch (Throwable $e) { send(['error' => 'hero_abilities_unavailable', 'message' => $e->getMessage()], 502); }
  }
  if ($path === '/api/dota/hero-positions') {
    // Живой Stratz с воркера давал 403 (токен привязан к IP), фактически всегда отдавался снимок.
    try { send(staticJson('/data/hero-positions.json')); }
    catch (Throwable $e) { send(['error' => 'hero_positions_unavailable', 'message' => $e->getMessage()], 502); }
  }
  if (preg_match('#^/api/dota/hero/(\d+)/build$#', $path, $m)) {
    try { send(staticJson('/data/builds/' . $m[1] . '.json')); }
    catch (Throwable $e) { send(['error' => 'hero_build_unavailable', 'message' => $e->getMessage()], 404); }
  }
  if ($path === '/api/dota/hero-stats') {
    try { send(heroStats()); }
    catch (Throwable $e) { send(['error' => 'hero_stats_unavailable', 'message' => $e->getMessage()], 502); }
  }
  send(['error' => 'not_found'], 404);
} catch (Throwable $e) {
  error_log('dotamate api: ' . $e->getMessage());
  send(['error' => 'internal_error'], 500);
}
