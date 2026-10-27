<?php
// /api/* для dotamate.ru на хостинге Hostiman (с 26.09.2026 вместо Cloudflare Worker).
// Контракт ответов унаследован от прежнего Cloudflare Worker (удалён 09.10.2026).
// Кеш и база лежат ВНЕ корня сайта (~/dotamate-data): выкладка подменяет корень целиком.

declare(strict_types=1);
const DOTAMATE_API = true;               // pro.php исполняется только отсюда

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

// --- Эфир /live: архив разобранных матчей (tools/replay/collect.js на этом же сервере) ---
// Расписание общее для всех зрителей: файл в ~/dotamate-data, правится под flock.
// Матч за матчем без остановки; новые матчи первыми, когда новых нет — по кругу из архива.
const LIVE_GAP = 20;                       // секунд заставки между матчами
function liveArchive(): string { return dirname(webroot(), 2) . '/dotamate-collector/archive'; }
function liveMatchFile(string $id): string { return liveArchive() . '/matches/' . $id . '.json'; }
function liveSchedule(): array {
  $f = dataDir() . '/live-schedule.json';
  $fh = fopen($f, 'c+');
  if (!$fh || !flock($fh, LOCK_EX)) throw new RuntimeException('schedule lock');
  try {
    $s = json_decode((string)stream_get_contents($fh), true) ?: [];
    $items = $s['items'] ?? []; $aired = $s['aired'] ?? [];
    $now = microtime(true);
    $items = array_values(array_filter($items, fn($i) => $i['start'] + $i['len'] > $now - 3600));
    $changed = false;
    // Держим в расписании текущий матч и следующий: следующий нужен странице для предзагрузки.
    while (true) {
      $last = end($items);
      $cur = null; foreach ($items as $k => $i) if ($i['start'] <= $now && $now < $i['start'] + $i['len']) $cur = $k;
      if ($last && $cur !== null && $cur < count($items) - 1) break;
      if ($last && $cur === null && $last['start'] > $now) break;   // идёт заставка перед следующим
      $idx = json_decode((string)@file_get_contents(liveArchive() . '/index.json'), true);
      $list = $idx['matches'] ?? [];
      if (!$list) throw new RuntimeException('live_empty');
      // Матчи схемы 3+ (полный инвентарь героев) — в эфир; старые (без инвентаря, покупки могли уйти не тому герою)
      // показываются, только пока новых нет.
      $good = array_values(array_filter($list, fn($m) => ($m['schema'] ?? 0) >= 3));
      if ($good) $list = $good;
      // Из них — сначала матчи с позициями крипов (поле creeps, с 02.10.2026 09:41 МСК).
      $withCreeps = array_values(array_filter($list, fn($m) => !empty($m['creeps'])));
      if ($withCreeps) $list = $withCreeps;
      $pick = null;
      // Сначала свежие про-матчи, потом остальные, не показанные за сутки.
      foreach ([true, false] as $wantPro) {
        foreach ($list as $m) if (!empty($m['pro']) === $wantPro && (!isset($aired[$m['matchId']]) || $now - $aired[$m['matchId']] > 86400)) { $pick = $m['matchId']; break; }
        if ($pick !== null) break;
      }
      if ($pick === null) { $old = $list; usort($old, fn($a, $b) => ($aired[$a['matchId']] ?? 0) <=> ($aired[$b['matchId']] ?? 0)); $pick = $old[0]['matchId']; }
      $mj = json_decode((string)@file_get_contents(liveMatchFile((string)$pick)), true);
      if (!$mj) { $aired[$pick] = $now; $changed = true; continue; }
      $start = $last ? max($last['start'] + $last['len'] + LIVE_GAP, $now) : $now;
      $items[] = ['id' => (string)$pick, 'start' => $start, 'len' => (int)$mj['t1'] - (int)$mj['t0'], 't0' => (int)$mj['t0']];
      $aired[$pick] = $start; $changed = true;
      if (count($items) > 50) break;
    }
    if ($changed) {
      if (count($aired) > 5000) { arsort($aired); $aired = array_slice($aired, 0, 5000, true); }
      ftruncate($fh, 0); rewind($fh);
      fwrite($fh, json_encode(['items' => $items, 'aired' => $aired], JSON_UNESCAPED_SLASHES));
    }
    return $items;
  } finally { flock($fh, LOCK_UN); fclose($fh); }
}
// Полоса матчей эфира (/api/live/list) и турнир матча (/api/live/card/<id>). Только файлы: архив эфира
// (index.json) и данные /pro/ (~/dotamate-data/pro, tools/pro/sync.js — тот же источник, что у раздела /pro/).
// Список общий для всех зрителей — собирается не чаще раза в LIVE_LIST_TTL с и лежит в cache/live-list.json.
const LIVE_LIST_TTL = 60;
const LIVE_LIST_PRO = 8;                   // последних про-матчей в полосе
const LIVE_LIST_RANK = 6;                  // последних рейтинговых матчей ранга «Властелин» (rank 60+, выше в архиве нет)
function liveSendCached($data, int $maxAge): void {
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: public, max-age=' . $maxAge);
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}
function liveProData(): array {
  static $d = null;
  if ($d !== null) return $d;
  $idx = json_decode((string)@file_get_contents(dataDir() . '/pro/index.json'), true)['matches'] ?? [];
  $ref = json_decode((string)@file_get_contents(dataDir() . '/pro/ref.json'), true)['heroes'] ?? [];
  $byId = []; $lgPage = [];
  foreach ($idx as $x) { $byId[(string)$x['id']] = $x; if (!empty($x['has'])) $lgPage[(int)($x['lg'] ?? 0)] = true; }
  return $d = ['idx' => $idx, 'byId' => $byId, 'lgPage' => $lgPage, 'ref' => $ref];
}
// Турнир, номер игры и счёт серии ДО этой игры (без спойлера итога). Счёт — по победам команд (id команд),
// не по сторонам: стороны между играми меняются. Не сходится (нет id команды, у команды уже нужное число побед) — счёта нет.
function liveTour(string $id): ?array {
  $P = liveProData(); $p = $P['byId'][$id] ?? null;
  if (!$p) return null;
  $lg = (int)($p['lg'] ?? 0);
  $bo = [0 => 1, 1 => 3, 2 => 5, 3 => 2][(int)($p['st'] ?? -1)] ?? null;
  $o = ['league' => (string)($p['ln'] ?? ''), 'leagueId' => $lg, 'leaguePage' => !empty($P['lgPage'][$lg]), 'matchPage' => !empty($p['has']),
        'bo' => $bo, 'game' => null, 'score' => null, 'radiant' => (string)($p['r'][1] ?? ''), 'dire' => (string)($p['d'][1] ?? '')];
  if (!empty($p['ser']) && $bo && $bo > 1) {
    $g = array_values(array_filter($P['idx'], fn($x) => (int)($x['ser'] ?? 0) === (int)$p['ser'] && (int)$x['start'] < (int)$p['start']));
    $r = $p['r'][0] ?? null; $d = $p['d'][0] ?? null; $sr = 0; $sd = 0; $ok = $r && $d;
    foreach ($g as $x) {
      $w = !empty($x['rw']) ? ($x['r'][0] ?? null) : ($x['d'][0] ?? null);
      if ($w !== null && $w === $r) $sr++; elseif ($w !== null && $w === $d) $sd++; else $ok = false;
    }
    $need = intdiv($bo, 2) + 1;
    if ($bo !== 2 && ($sr >= $need || $sd >= $need)) $ok = false;
    $o['game'] = count($g) + 1;
    if ($ok) $o['score'] = [$sr, $sd];
  }
  return $o;
}
function liveCard(array $m): array {
  $P = liveProData(); $id = (string)$m['matchId'];
  $slugs = array_map(fn($h) => (string)($P['ref'][$h][0] ?? ''), $m['heroes'] ?? []);
  $c = ['matchId' => $id, 'end' => (int)($m['endTime'] ?? 0), 'dur' => (int)($m['duration'] ?? 0), 'rank' => $m['rank'] ?? null, 'heroes' => $slugs, 'pro' => null];
  if (!empty($m['pro'])) $c['pro'] = ['league' => (string)($m['pro']['league'] ?? ''), 'radiant' => (string)($m['pro']['radiant'] ?? ''), 'dire' => (string)($m['pro']['dire'] ?? ''), 'tour' => liveTour($id)];
  return $c;
}
function liveArchiveList(): array {
  $list = json_decode((string)@file_get_contents(liveArchive() . '/index.json'), true)['matches'] ?? [];
  return array_values(array_filter($list, fn($m) => ($m['schema'] ?? 0) >= 3 && !empty($m['creeps'])));
}
function liveList(): array {
  $cache = dataDir() . '/cache/live-list.json';
  $c = json_decode((string)@file_get_contents($cache), true);
  if ($c && time() - (int)($c['built'] ?? 0) < LIVE_LIST_TTL) return $c;
  $list = liveArchiveList();
  usort($list, fn($a, $b) => ($b['endTime'] ?? 0) <=> ($a['endTime'] ?? 0));
  $items = []; $np = 0; $nr = 0;
  foreach ($list as $m) {
    $pro = !empty($m['pro']);
    if ($pro ? $np >= LIVE_LIST_PRO : ((int)($m['rank'] ?? 0) < 60 || $nr >= LIVE_LIST_RANK)) continue;
    if (!is_file(liveMatchFile((string)$m['matchId']))) continue;
    if ($pro) $np++; else $nr++;
    $items[] = liveCard($m);
    if ($np >= LIVE_LIST_PRO && $nr >= LIVE_LIST_RANK) break;
  }
  $c = ['built' => time(), 'items' => $items];
  $tmp = $cache . '.' . getmypid();
  if (@file_put_contents($tmp, json_encode($c, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) !== false) @rename($tmp, $cache);
  return $c;
}
// --- Эфир /live, чат 5: частые слова из чата матча и опрос «кто победит» ---
// Слова считаются здесь, из файла матча (chat: [сек, слот, текст]); результат не меняется — кеш навсегда в cache/live-words/.
// Слово учитывается один раз на сообщение («gg gg gg» — одно gg). Отдаём LIVE_WORDS_TOP слов с секундами появления:
// страница эфира сама считает, сколько раз слово прозвучало к текущей секунде, — без спойлеров конца матча.
const LIVE_WORDS_V = 2;
const LIVE_WORDS_TOP = 30;
const LIVE_STOP = 'и в во не что он на я с со как а то все всё она так его но да ты к у же вы за бы по только ее её мне было вот от меня еще ещё нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя тебе их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее неё сейчас были куда зачем всех никогда можно при наконец два об другой хоть после над больше тот через эти нас про всего них какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им более всегда конечно всю между это че чо що шо ща щас тип типа вообще просто короче мб есть ваш наш твой твоя мои твои'
  . ' the a an and or but if of to in on at by for with from as is are was were be been am it its it\'s this that these those i me my we us our you your u ur he him his she her they them their what which who whom why how when where there here not no do does did dont don have has had just so too very can will would should could all any some me im ive youre thats then than also only about into out up down over again more most such own same other'
  . ' de la que el en y a los se del las un por con no una su para es al lo como mas más pero sus le ya o este si sí porque esta está entre cuando muy sin sobre también me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mí antes algunos qué unos yo otro otras otra él tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros mi mis tú te ti tu tus ellas vosotros os mío mía tuyo suyo estoy estas estamos son soy eres fue era ser hace hacer pa q k xq pq ta tá'
  . ' o os as um uma do da dos das em no na nos nas por para com não nao mais mas ao aos à às seu sua ou quando muito já ja eu também só pelo pela até isso ela entre depois sem mesmo ele eles você voce vc tu te ti meu minha teu tua nosso essa esse isso esta este aqui ai aí ta tá é foi ser sou vai vou tem';
// Мат не фильтруется (решение владельца 09.10.2026): считаем всё, что пишут игроки, кроме ссылок и служебных слов.
// Ссылки и адреса: вырезаются из сообщения до разбиения на слова, чтобы куски адреса не попали в список.
const LIVE_URL_RE = '~(?:https?://|www\.)\S*|\S+\.(?:com|ru|net|org|gg|io|me|tv|xyz|br|ar|pe|cl|co|info|su|ua|kz|by|link|ly|to)(?:/\S*)?~iu';
// Слова одного сообщения: нижний регистр, ё→е, без пунктуации, ссылок и служебных слов, каждое слово один раз.
function liveTokens(string $text, array $stop): array {
  $seen = [];
  $s = preg_replace(LIVE_URL_RE, ' ', mb_strtolower($text, 'UTF-8')) ?? '';
  foreach (preg_split('/[^\p{L}\p{N}]+/u', $s, -1, PREG_SPLIT_NO_EMPTY) ?: [] as $w) {
    $w = str_replace('ё', 'е', $w); $len = mb_strlen($w, 'UTF-8');
    if ($len < 2 || $len > 20 || isset($seen[$w]) || isset($stop[$w]) || !preg_match('/\p{L}/u', $w)) continue;
    $seen[$w] = true;
  }
  return array_keys($seen);
}
function liveWords(string $id): array {
  $dir = dataDir() . '/cache/live-words'; if (!is_dir($dir)) @mkdir($dir, 0700, true);
  $c = "$dir/$id.json";
  $v = json_decode((string)@file_get_contents($c), true);
  if (is_array($v) && ($v['v'] ?? 0) === LIVE_WORDS_V) return $v;
  $m = json_decode((string)file_get_contents(liveMatchFile($id)), true);
  if (!is_array($m)) throw new RuntimeException('bad_match');
  static $stop = null; $stop ??= array_flip(explode(' ', LIVE_STOP));
  $times = []; $msgs = 0;
  foreach (($m['chat'] ?? []) as $x) {
    if (!is_array($x) || !is_string($x[2] ?? null)) continue;
    $msgs++;
    foreach (liveTokens($x[2], $stop) as $w) $times[$w][] = (int)$x[0];
  }
  uksort($times, fn($a, $b) => count($times[$b]) <=> count($times[$a]) ?: $times[$a][0] <=> $times[$b][0]);
  $words = []; foreach (array_slice($times, 0, LIVE_WORDS_TOP, true) as $w => $t) $words[] = [(string)$w, $t];
  $v = ['v' => LIVE_WORDS_V, 'matchId' => $id, 'msgs' => $msgs, 'words' => $words];
  $tmp = $c . '.' . getmypid();
  if (@file_put_contents($tmp, json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) !== false) @rename($tmp, $c);
  if (mt_rand(1, 200) === 1) foreach (glob("$dir/*.json") ?: [] as $f) if (time() - (int)@filemtime($f) > 30 * 86400) @unlink($f);
  return $v;
}
// Частые слова за всё время (/api/live/words-all, страница /live/words/): общий накопительный счётчик по чатам
// всех матчей архива эфира. Итог в ~/dotamate-data/live-words-total.json {done: номера учтённых матчей, counts}.
// Матч учитывается один раз; файлы матчей архив удаляет через 14 дней, но их слова в счётчике остаются.
// Новые матчи добавляются не чаще раза в LIVE_WORDS_ALL_TTL с и не больше LIVE_WORDS_ALL_STEP за раз (файл ~0,6 МБ).
const LIVE_WORDS_ALL_TTL = 600;
const LIVE_WORDS_ALL_STEP = 25;
const LIVE_WORDS_ALL_TOP = 120;
const LIVE_WORDS_ALL_KEYS = 60000;         // больше — редкие слова отбрасываются, иначе файл растёт без предела
function liveWordsAll(): array {
  $out = dataDir() . '/cache/live-words-all.json';
  $o = json_decode((string)@file_get_contents($out), true);
  if (is_array($o) && ($o['v'] ?? 0) === LIVE_WORDS_V && time() - (int)($o['built'] ?? 0) < LIVE_WORDS_ALL_TTL) return $o;
  $fh = fopen(dataDir() . '/live-words-total.json', 'c+');
  if (!$fh) throw new RuntimeException('words_total_open');
  if (!flock($fh, LOCK_EX | LOCK_NB)) { if (is_array($o)) return $o; if (!flock($fh, LOCK_EX)) throw new RuntimeException('words_total_lock'); }
  try {
    $t = json_decode((string)stream_get_contents($fh), true);
    if (!is_array($t) || ($t['v'] ?? 0) !== LIVE_WORDS_V) $t = ['v' => LIVE_WORDS_V, 'since' => time(), 'msgs' => 0, 'done' => [], 'counts' => []];
    static $stop = null; $stop ??= array_flip(explode(' ', LIVE_STOP));
    $files = glob(liveArchive() . '/matches/*.json') ?: []; sort($files);
    $added = 0; $pending = 0;
    foreach ($files as $file) {
      $id = basename($file, '.json');
      if (!preg_match('/^\d{6,12}$/', $id) || isset($t['done'][$id])) continue;
      if ($added >= LIVE_WORDS_ALL_STEP) { $pending++; continue; }
      $m = json_decode((string)@file_get_contents($file), true);
      if (!is_array($m)) continue;            // файл ещё пишется или испорчен — попробуем в следующий раз
      foreach (($m['chat'] ?? []) as $x) {
        if (!is_array($x) || !is_string($x[2] ?? null)) continue;
        $t['msgs']++;
        foreach (liveTokens($x[2], $stop) as $w) $t['counts'][$w] = ($t['counts'][$w] ?? 0) + 1;
      }
      $t['done'][$id] = 1; $added++; unset($m);
    }
    if (count($t['counts']) > LIVE_WORDS_ALL_KEYS) { arsort($t['counts']); $t['counts'] = array_slice($t['counts'], 0, (int)(LIVE_WORDS_ALL_KEYS * 0.8), true); }
    if ($added) { ftruncate($fh, 0); rewind($fh); fwrite($fh, json_encode($t, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)); fflush($fh); }
  } finally { flock($fh, LOCK_UN); fclose($fh); }
  $c = $t['counts']; arsort($c);
  $words = []; foreach (array_slice($c, 0, LIVE_WORDS_ALL_TOP, true) as $w => $n) $words[] = [(string)$w, $n];
  $o = ['v' => LIVE_WORDS_V, 'built' => time(), 'since' => (int)$t['since'], 'matches' => count($t['done']), 'msgs' => (int)$t['msgs'], 'pending' => $pending, 'words' => $words];
  $tmp = $out . '.' . getmypid();
  if (@file_put_contents($tmp, json_encode($o, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) !== false) @rename($tmp, $out);
  return $o;
}
// Опрос «кто победит»: голосовать можно, пока матч идёт в общем эфире (и за минуту до начала).
// Один голос на браузер: метка в cookie dm_lv (HttpOnly, случайные 128 бит; в базе — только её хеш).
// Новая метка (очистка cookie, другой браузер) упирается в лимит по IP: LIVE_POLL_IP_MATCH голосов на матч
// с одного адреса (семья или общежитие за одним IP) и LIVE_POLL_IP_HOUR голосов в час на все матчи.
// Счёт до своего голоса не показывается, пока опрос открыт, — чтобы не голосовали за большинство.
const LIVE_POLL_IP_MATCH = 3;
const LIVE_POLL_IP_HOUR = 20;
function liveDb(): PDO {
  $db = new PDO('sqlite:' . dataDir() . '/live.sqlite');
  $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
  $db->exec('PRAGMA busy_timeout = 3000');
  $db->exec('CREATE TABLE IF NOT EXISTS live_votes (match_id TEXT NOT NULL, voter TEXT NOT NULL, ip_hash TEXT, side INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (match_id, voter))');
  $db->exec('CREATE INDEX IF NOT EXISTS live_votes_ip ON live_votes(ip_hash, created_at)');
  return $db;
}
function liveVoter(bool $issue): ?string {
  $v = (string)($_COOKIE['dm_lv'] ?? '');
  if (preg_match('/^[a-f0-9]{32}$/', $v)) return $v;
  if (!$issue) return null;
  $v = bin2hex(random_bytes(16));
  $https = ($_SERVER['HTTPS'] ?? '') === 'on' || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https' || (int)($_SERVER['SERVER_PORT'] ?? 0) === 443;
  setcookie('dm_lv', $v, ['expires' => time() + 365 * 86400, 'path' => '/api/live/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Strict']);
  return $v;
}
function livePollOpen(string $id): bool {
  $s = json_decode((string)@file_get_contents(dataDir() . '/live-schedule.json'), true);
  $now = microtime(true);
  foreach (($s['items'] ?? []) as $i) if ((string)($i['id'] ?? '') === $id && $now >= $i['start'] - 60 && $now < $i['start'] + $i['len']) return true;
  return false;
}
function livePoll(string $id, ?string $voter, ?bool $open = null): array {
  $db = liveDb();
  $q = $db->prepare('SELECT side, COUNT(*) FROM live_votes WHERE match_id = ? GROUP BY side'); $q->execute([$id]);
  $n = [0, 0]; foreach ($q->fetchAll(PDO::FETCH_NUM) as $r) $n[(int)$r[0] ? 1 : 0] = (int)$r[1];
  $my = null;
  if ($voter) { $q = $db->prepare('SELECT side FROM live_votes WHERE match_id = ? AND voter = ?'); $q->execute([$id, hash('sha256', 'dm-lv:' . $voter)]); $s = $q->fetchColumn(); if ($s !== false) $my = (int)$s ? 'd' : 'r'; }
  $open ??= livePollOpen($id);
  $show = !$open || $my !== null;
  return ['matchId' => $id, 'open' => $open, 'my' => $my, 'r' => $show ? $n[0] : null, 'd' => $show ? $n[1] : null, 'total' => $show ? $n[0] + $n[1] : null];
}
function liveVote(string $id): void {
  $origins = FEEDBACK_ORIGINS; if (getenv('DOTAMATE_DEV_ORIGIN')) $origins[] = getenv('DOTAMATE_DEV_ORIGIN');
  if (!in_array($_SERVER['HTTP_ORIGIN'] ?? '', $origins, true)) send(['error' => 'forbidden'], 403);
  if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 200) send(['error' => 'too_large'], 413);
  $body = json_decode((string)file_get_contents('php://input', false, null, 0, 201), true);
  $side = is_array($body) ? ($body['side'] ?? '') : '';
  if ($side !== 'r' && $side !== 'd') send(['error' => 'bad_side'], 400);
  $voter = liveVoter(false);
  if (!$voter) send(['error' => 'no_cookie'], 403);          // метку выдаёт GET опроса: голос без него — не из браузера со страницы
  if (!livePollOpen($id)) send(['error' => 'poll_closed'] + livePoll($id, $voter, false), 409);
  $ip = $_SERVER['REMOTE_ADDR'] ?? ''; $ipHash = $ip !== '' ? hash('sha256', 'dotamate-poll:' . $ip) : null;
  $now = (int)floor(microtime(true) * 1000); $vh = hash('sha256', 'dm-lv:' . $voter);
  $db = liveDb();
  $db->exec('BEGIN IMMEDIATE');
  try {
    $q = $db->prepare('SELECT 1 FROM live_votes WHERE match_id = ? AND voter = ?'); $q->execute([$id, $vh]);
    if ($q->fetchColumn()) { $db->exec('ROLLBACK'); send(['error' => 'already_voted'] + livePoll($id, $voter, true), 409); }
    if ($ipHash) {
      $q = $db->prepare('SELECT COUNT(*) FROM live_votes WHERE ip_hash = ? AND match_id = ?'); $q->execute([$ipHash, $id]);
      if ((int)$q->fetchColumn() >= LIVE_POLL_IP_MATCH) { $db->exec('ROLLBACK'); send(['error' => 'rate_limited'], 429); }
      $q = $db->prepare('SELECT COUNT(*) FROM live_votes WHERE ip_hash = ? AND created_at > ?'); $q->execute([$ipHash, $now - 3600000]);
      if ((int)$q->fetchColumn() >= LIVE_POLL_IP_HOUR) { $db->exec('ROLLBACK'); send(['error' => 'rate_limited'], 429); }
    }
    $db->prepare('INSERT INTO live_votes (match_id, voter, ip_hash, side, created_at) VALUES (?, ?, ?, ?, ?)')->execute([$id, $vh, $ipHash, $side === 'd' ? 1 : 0, $now]);
    $db->prepare('UPDATE live_votes SET ip_hash = NULL WHERE ip_hash IS NOT NULL AND created_at < ?')->execute([$now - 2 * 86400000]);
    $db->exec('COMMIT');
  } catch (Throwable $e) { try { $db->exec('ROLLBACK'); } catch (Throwable $_) {} throw $e; }
  send(livePoll($id, $voter, true));
}
function handleLive(string $path): void {
  if (preg_match('#^/api/live/poll/(\d{6,12})$#', $path, $m)) {
    if (!is_file(liveMatchFile($m[1]))) send(['error' => 'match_not_found'], 404);
    if ($_SERVER['REQUEST_METHOD'] === 'POST') liveVote($m[1]);
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') send(['error' => 'method_not_allowed'], 405);
    send(livePoll($m[1], liveVoter(true)));
  }
  if ($_SERVER['REQUEST_METHOD'] !== 'GET') send(['error' => 'method_not_allowed'], 405);
  if ($path === '/api/live/words-all') {
    try { $w = liveWordsAll(); } catch (Throwable $e) { send(['error' => 'words_unavailable'], 503); }
    liveSendCached($w, 300);
  }
  if (preg_match('#^/api/live/words/(\d{6,12})$#', $path, $m)) {
    if (!is_file(liveMatchFile($m[1]))) send(['error' => 'match_not_found'], 404);
    try { $w = liveWords($m[1]); } catch (Throwable $e) { send(['error' => 'words_unavailable'], 503); }
    liveSendCached($w, 86400);
  }
  if ($path === '/api/live/now') {
    try { $items = liveSchedule(); }
    catch (Throwable $e) { send(['error' => $e->getMessage() === 'live_empty' ? 'live_empty' : 'live_unavailable'], 503); }
    $now = microtime(true); $cur = null; $next = null; $prev = null;
    foreach ($items as $i) {
      // prev — матч, закончившийся в последнюю паузу: страница, открытая во время заставки, показывает его итог.
      if ($i['start'] + $i['len'] <= $now && $now < $i['start'] + $i['len'] + LIVE_GAP + 5) $prev = $i;
      if ($i['start'] <= $now && $now < $i['start'] + $i['len']) $cur = $i;
      elseif ($i['start'] > $now && $next === null) $next = $i;
    }
    $out = fn($i) => $i ? ['matchId' => $i['id'], 'start' => (int)round($i['start'] * 1000), 'len' => $i['len'], 't0' => $i['t0']] : null;
    send(['serverTime' => (int)round($now * 1000), 'current' => $out($cur), 'next' => $out($next), 'prev' => $out($prev)]);
  }
  if (preg_match('#^/api/live/match/(\d{6,12})$#', $path, $m)) {
    $f = liveMatchFile($m[1]);
    if (!is_file($f)) send(['error' => 'match_not_found'], 404);
    // Файл матча не меняется: кешируем на сутки, отдаём сжатым, если браузер умеет.
    header('Cache-Control: public, max-age=86400, immutable');
    header('Content-Type: application/json; charset=utf-8');
    if (strpos($_SERVER['HTTP_ACCEPT_ENCODING'] ?? '', 'gzip') !== false && function_exists('gzencode')) {
      header('Content-Encoding: gzip'); header('Vary: Accept-Encoding');
      echo gzencode((string)file_get_contents($f), 6);
    } else readfile($f);
    exit;
  }
  if ($path === '/api/live/list') liveSendCached(liveList(), LIVE_LIST_TTL);
  if (preg_match('#^/api/live/card/(\d{6,12})$#', $path, $m)) {
    foreach (liveArchiveList() as $x) if ((string)$x['matchId'] === $m[1]) liveSendCached(liveCard($x), 300);
    send(['error' => 'match_not_found'], 404);
  }
  if ($path === '/api/live/online') {
    try { $l = onlineList(); } catch (SteamError $e) { onlineFail($e); }
    liveSendCached(['at' => $l['at'], 'games' => $l['games']], 30);
  }
  if (preg_match('#^/api/live/online/(\d{15,20})$#', $path, $m)) {
    try { $g = onlineGame($m[1]); } catch (SteamError $e) { onlineFail($e); }
    header('Cache-Control: no-cache');
    header('Content-Type: application/json; charset=utf-8');
    $body = json_encode($g, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (strpos($_SERVER['HTTP_ACCEPT_ENCODING'] ?? '', 'gzip') !== false && function_exists('gzencode')) { header('Content-Encoding: gzip'); header('Vary: Accept-Encoding'); echo gzencode($body, 5); }
    else echo $body;
    exit;
  }
  if ($path === '/api/live/heat') {
    $f = liveArchive() . '/heat.json';
    if (!is_file($f)) send(['error' => 'heat_not_ready'], 404);
    header('Cache-Control: public, max-age=3600');
    header('Content-Type: application/json; charset=utf-8');
    readfile($f); exit;
  }
  send(['error' => 'not_found'], 404);
}

// --- Эфир «Сейчас в игре»: идущие матчи из Steam Web API (claude/efir-online.md) ---
// GetTopLiveGame — список (кеш ONLINE_LIST_TTL с, один на всех), GetRealtimeStats — один матч (кеш ONLINE_RT_TTL с).
// Steam опрашивается только пока матч кто-то смотрит; свой суточный счётчик, отдельный от /me.
// Valve отдаёт эти данные с задержкой трансляции (поле delay: 120/300/900 с) — это и показывается зрителю.
// Координаты Steam (−1…1) переводятся в клетки карты архива эфира: прямая по 14 строениям матча 9036719525
// (x = 128,014 + 159,52·x, y = 126,008 + 163,5·y; расхождение с позициями MapProbe ≤ 0,05 клетки).
const ONLINE_LIST_TTL = 60, ONLINE_RT_TTL = 4, ONLINE_MAX = 8, ONLINE_BUDGET = 30000;
const ONLINE_FRAMES = 40, ONLINE_STEP = 10, ONLINE_HIST = 480;     // кадров позиций; шаг и длина истории капитала (80 мин)
// Строения в ответе Steam: 36 записей, по 18 на сторону в этом порядке. Разрушенное приходит обнулённым,
// поэтому имя берётся по месту в списке; целые проверяются по [тип, линия, уровень] — порядок сменился, строения не пишутся.
const ONLINE_BLD = ['tower1_top', 'tower2_top', 'tower3_top', 'tower1_mid', 'tower2_mid', 'tower3_mid', 'tower1_bot', 'tower2_bot', 'tower3_bot', 'tower4', 'tower4',
  'melee_rax_top', 'range_rax_top', 'melee_rax_mid', 'range_rax_mid', 'melee_rax_bot', 'range_rax_bot', 'fort'];
const ONLINE_BLD_CHK = [[0, 1, 1], [0, 1, 2], [0, 1, 3], [0, 2, 1], [0, 2, 2], [0, 2, 3], [0, 3, 1], [0, 3, 2], [0, 3, 3], [0, 2, 4], [0, 2, 4],
  [1, 1, 1], [1, 1, 1], [1, 2, 1], [1, 2, 1], [1, 3, 1], [1, 3, 1], [2, 0, 0]];

function onlineDir(): string { $d = dataDir() . '/cache/online'; if (!is_dir($d)) @mkdir($d, 0700, true); return $d; }
function onlineFail(SteamError $e): void {
  $map = ['not_found' => ['online_not_found', 404], 'budget' => ['rate_limited', 429], 'rate_limited' => ['rate_limited', 429], 'busy' => ['busy', 503], 'timeout' => ['timeout', 504]];
  [$err, $code] = $map[$e->kind] ?? ['upstream_error', 502];
  send(['error' => $err], $code);
}
function onlineCall(string $path, array $q): array {
  $key = steamKey();
  if ($key === '') throw new SteamError('upstream_error');
  if (!steamSpend(onlineDir() . '/budget.json', ONLINE_BUDGET)) throw new SteamError('budget');
  $ch = curl_init('https://api.steampowered.com/' . $path . '/v1/?' . http_build_query($q + ['key' => $key]));
  unset($key);
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 6, CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_USERAGENT => 'dotamate.ru', CURLOPT_HTTPHEADER => ['Accept: application/json']]);
  $body = curl_exec($ch); $errno = curl_errno($ch); $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE); curl_close($ch);
  if ($errno) throw new SteamError($errno === CURLE_OPERATION_TIMEDOUT ? 'timeout' : 'upstream_error');
  if ($code === 429) throw new SteamError('rate_limited');
  $j = $code === 200 ? json_decode((string)$body, true) : null;
  if (!is_array($j)) throw new SteamError('upstream_error');
  return $j;
}
function onlineLeagues(): array {                                   // id лиги → название (из данных /pro/)
  $m = []; foreach (liveProData()['idx'] as $x) if (!empty($x['lg']) && !empty($x['ln'])) $m[(int)$x['lg']] = (string)$x['ln'];
  return $m;
}
// Список идущих матчей: сначала турнирные (по числу зрителей), потом рейтинговые. Матчи на стадии драфта (game_time ≤ 0) не берутся.
function onlineList(): array {
  $f = onlineDir() . '/list.json'; $c = readJsonFile($f);
  if (is_array($c) && time() - ($c['at'] ?? 0) < ONLINE_LIST_TTL) return $c;
  $h = @fopen(onlineDir() . '/list.lock', 'c');
  if (!$h || !flock($h, LOCK_EX | LOCK_NB)) { if ($h) fclose($h); if (is_array($c)) return $c; throw new SteamError('busy'); }
  try {
    $c = readJsonFile($f);
    if (is_array($c) && time() - ($c['at'] ?? 0) < ONLINE_LIST_TTL) return $c;
    try { $j = onlineCall('IDOTA2Match_570/GetTopLiveGame', ['partner' => 0]); }
    catch (SteamError $e) { if (is_array($c)) return $c; throw $e; }   // Steam не ответил — отдаём прошлый список
    $ref = liveProData()['ref']; $lg = onlineLeagues(); $out = [];
    foreach (($j['game_list'] ?? []) as $g) {
      $sid = (string)($g['server_steam_id'] ?? '');
      if ((int)($g['game_time'] ?? 0) <= 0 || !preg_match('/^\d{15,20}$/', $sid) || count($g['players'] ?? []) !== 10) continue;
      $hr = []; $hd = [];
      foreach ($g['players'] as $p) { $s = (string)($ref[(int)($p['hero_id'] ?? 0)][0] ?? ''); if ((int)($p['team'] ?? 0) === 0) $hr[] = $s; else $hd[] = $s; }
      $l = (int)($g['league_id'] ?? 0);
      $out[] = ['sid' => $sid, 'matchId' => (string)($g['match_id'] ?? ''), 'leagueId' => $l, 'league' => $l ? ($lg[$l] ?? null) : null, 'mmr' => (int)($g['average_mmr'] ?? 0),
        'radiant' => (string)($g['team_name_radiant'] ?? ''), 'dire' => (string)($g['team_name_dire'] ?? ''), 'gt' => (int)$g['game_time'], 'delay' => (int)($g['delay'] ?? 0),
        'viewers' => (int)($g['spectators'] ?? 0), 'score' => [(int)($g['radiant_score'] ?? 0), (int)($g['dire_score'] ?? 0)], 'heroes' => array_merge($hr, $hd)];
    }
    usort($out, fn($a, $b) => (($b['leagueId'] > 0) <=> ($a['leagueId'] > 0)) ?: ($b['viewers'] <=> $a['viewers']));
    $c = ['at' => time(), 'games' => array_slice($out, 0, ONLINE_MAX)];
    writeJsonFile($f, $c);
    foreach (glob(onlineDir() . '/g-*') ?: [] as $x) if (time() - (int)@filemtime($x) > 7200) @unlink($x);
    return $c;
  } finally { flock($h, LOCK_UN); fclose($h); }
}
// Состояние одного матча. Запрашивать можно только матч из текущего списка — чтобы чужие server_steam_id не тратили лимит.
// Матч пропал из списка — считается законченным, отдаётся последнее состояние.
function onlineGame(string $sid): array {
  $g = null; foreach (onlineList()['games'] as $x) if ($x['sid'] === $sid) $g = $x;
  $f = onlineDir() . '/g-' . $sid . '.json'; $s = readJsonFile($f);
  if (!$g) { if (!is_array($s)) throw new SteamError('not_found'); if (empty($s['ended'])) { $s['ended'] = true; writeJsonFile($f, $s); } return $s; }
  if (is_array($s) && (!empty($s['ended']) || microtime(true) - ($s['fetched'] ?? 0) < ONLINE_RT_TTL)) return $s;
  $h = @fopen($f . '.lock', 'c');
  if (!$h || !flock($h, LOCK_EX | LOCK_NB)) { if ($h) fclose($h); if (is_array($s)) return $s; throw new SteamError('busy'); }
  try {
    $s = readJsonFile($f);
    if (is_array($s) && microtime(true) - ($s['fetched'] ?? 0) < ONLINE_RT_TTL) return $s;
    try { $j = onlineCall('IDOTA2MatchStats_570/GetRealtimeStats', ['server_steam_id' => $sid]); }
    catch (SteamError $e) { if (is_array($s)) return $s; throw $e; }
    $s = onlineMerge(is_array($s) ? $s : null, $j, $g);
    writeJsonFile($f, $s);
    return $s;
  } finally { flock($h, LOCK_UN); fclose($h); }
}
function onlineMerge(?array $s, array $j, array $g): array {
  $m = $j['match'] ?? []; $gt = (int)($m['game_time'] ?? 0);
  $s = $s ?: ['sid' => $g['sid'], 'matchId' => $g['matchId'], 'leagueId' => $g['leagueId'], 'league' => $g['league'], 'mmr' => $g['mmr'], 'since' => null, 'gt' => 0,
    'teams' => null, 'players' => [], 'frames' => [], 'hist' => ['from' => null, 'step' => ONLINE_STEP, 'nw' => []], 'bld' => [], 'deaths' => [], 'ended' => false, 'radiantWin' => null];
  $s['fetched'] = microtime(true); $s['delay'] = $g['delay']; $s['viewers'] = $g['viewers'];
  $s['phase'] = (int)($m['game_state'] ?? 0);              // 2–3 драфт, 4 до начала, 5 игра, 6+ конец (DOTA_GameState)
  if ($s['phase'] >= 6) $s['ended'] = true;
  // В драфте Valve отдаёт героев и позиции нулями — такие кадры не берём.
  if ($s['phase'] !== 5 || $gt <= 0 || $gt < $s['gt'] || empty($j['teams'])) return $s;  // пустой или более старый кадр — оставляем прежнее
  $ref = liveProData()['ref']; $items = meItemsMeta(); $ps = []; $tm = [];
  foreach ($j['teams'] as $t) {
    $num = (int)($t['team_number'] ?? 0); $side = $num === 2 ? 'radiant' : ($num === 3 ? 'dire' : null);
    if (!$side) continue;
    $tm[$side] = ['name' => (string)($t['team_name'] ?? ''), 'score' => (int)($t['score'] ?? 0), 'nw' => (int)($t['net_worth'] ?? 0)];
    $pl = $t['players'] ?? []; usort($pl, fn($a, $b) => (int)($a['playerid'] ?? 0) <=> (int)($b['playerid'] ?? 0));   // слот — по номеру игрока, порядок в ответе не гарантирован
    foreach (array_slice($pl, 0, 5) as $i => $p) {
      $slot = ($side === 'radiant' ? 0 : 5) + $i; $hid = (int)($p['heroid'] ?? 0); $inv = [];
      foreach (array_slice($p['items'] ?? [], 0, 6) as $it) if ((int)$it > 0 && isset($items[(int)$it])) $inv[] = $items[(int)$it][3];
      $ps[$slot] = ['slot' => $slot, 'team' => $side, 'heroId' => $hid, 'slug' => (string)($ref[$hid][0] ?? ''), 'hero' => (string)($ref[$hid][1] ?? ''),
        'lvl' => (int)($p['level'] ?? 0), 'k' => (int)($p['kill_count'] ?? 0), 'd' => (int)($p['death_count'] ?? 0), 'a' => (int)($p['assists_count'] ?? 0),
        'lh' => (int)($p['lh_count'] ?? 0), 'dn' => (int)($p['denies_count'] ?? 0), 'gold' => (int)($p['gold'] ?? 0), 'nw' => (int)($p['net_worth'] ?? 0),
        'x' => round(128.014 + 159.52 * (float)($p['x'] ?? 0), 1), 'y' => round(126.008 + 163.5 * (float)($p['y'] ?? 0), 1), 'items' => $inv];
    }
  }
  if (count($ps) !== 10 || count($tm) !== 2) return $s;
  ksort($ps); $ps = array_values($ps);
  if ($s['players'] && array_column($s['players'], 'heroId') !== array_column($ps, 'heroId')) { $s['frames'] = []; $s['players'] = []; $s['deaths'] = []; $s['bld'] = []; $s['since'] = null; $s['gt'] = 0; $s['hist'] = ['from' => null, 'step' => ONLINE_STEP, 'nw' => []]; }
  // Смерти — по росту счётчика смертей между кадрами; место — последняя известная позиция. Убийца известен, только если
  // за этот промежуток ровно одна смерть и ровно одно убийство у соперника.
  if ($s['players']) {
    $old = []; foreach ($s['players'] as $p) $old[$p['slot']] = $p;
    $vic = []; $kil = [];
    foreach ($ps as $p) { $o = $old[$p['slot']] ?? null; if (!$o) continue;
      for ($n = $p['d'] - $o['d']; $n > 0; $n--) $vic[] = $o;
      for ($n = $p['k'] - $o['k']; $n > 0; $n--) $kil[] = $p['slot']; }
    foreach ($vic as $v) $s['deaths'][] = ['t' => $gt, 'victim' => $v['slot'], 'killer' => count($vic) === 1 && count($kil) === 1 && ($kil[0] < 5) !== ($v['slot'] < 5) ? $kil[0] : -1, 'x' => $v['x'], 'y' => $v['y']];
    $s['deaths'] = array_slice($s['deaths'], -60);
  }
  $b = $j['buildings'] ?? []; $ok = count($b) === 36;
  if ($ok) foreach ($b as $i => $x) { $c = ONLINE_BLD_CHK[$i % 18];
    if (empty($x['destroyed']) && ((int)($x['team'] ?? 0) !== ($i < 18 ? 2 : 3) || (int)($x['type'] ?? -1) !== $c[0] || (int)($x['lane'] ?? -1) !== $c[1] || (int)($x['tier'] ?? -1) !== $c[2])) { $ok = false; break; } }
  if ($ok) foreach ($b as $i => $x) if (!empty($x['destroyed']) && !isset($s['bld'][(string)$i]))
    $s['bld'][(string)$i] = ['name' => ($i < 18 ? 'goodguys_' : 'badguys_') . ONLINE_BLD[$i % 18], 't' => $s['since'] === null ? null : $gt];   // null — разрушено до начала наблюдения
  foreach ($s['bld'] as $x) if (substr($x['name'], -5) === '_fort') { $s['ended'] = true; $s['radiantWin'] = strpos($x['name'], 'badguys') === 0; }
  $fr = []; foreach ($ps as $p) { $fr[] = $p['x']; $fr[] = $p['y']; }
  $s['frames'][] = [$gt, $fr]; $s['frames'] = array_slice($s['frames'], -ONLINE_FRAMES);
  $k = intdiv($gt, ONLINE_STEP); $H = &$s['hist'];
  if ($H['from'] === null) $H['from'] = $k;
  for ($q = count($H['nw']); $q < $k - $H['from']; $q++) $H['nw'][] = null;
  $H['nw'][$k - $H['from']] = array_map(fn($p) => $p['nw'], $ps);
  if (count($H['nw']) > ONLINE_HIST) { $cut = count($H['nw']) - ONLINE_HIST; $H['nw'] = array_slice($H['nw'], $cut); $H['from'] += $cut; }
  unset($H);
  if ($s['since'] === null) $s['since'] = $gt;
  $s['gt'] = $gt; $s['teams'] = $tm; $s['players'] = $ps;
  return $s;
}

// --- Мой профиль /me: матчи игрока из Steam Web API (claude/plan-me-profil.md, задача B) ---
// Ключ — только из файла вне корня сайта; в ответы, логи и тексты исключений не попадает.
const STEAM_API = 'https://api.steampowered.com/IDOTA2Match_570';
const STEAM_DAILY_BUDGET = 60000;      // из 100 000 вызовов/сутки на ключ
const STEAM_SLOTS = 4;                 // одновременных загрузок из Steam (посетителей)
const STEAM_PARALLEL = 8;              // запросов подробностей матча одновременно в одной загрузке (проверено: 30 матчей по 10 — 2 с, 429 нет)
const STEAM_CALL_TIMEOUT = 8;          // с, один вызов
const STEAM_TOTAL_TIMEOUT = 25;        // с, весь запрос
const STEAM_HIST_TTL = 3600;           // список матчей — 1 ч
const STEAM_CACHE_LIMIT = 200 * 1024 * 1024;
const STEAM64_BASE = 76561197960265728;
// Версия кеша матча: 2 — +denies/tower_damage/hero_healing/level (позиции), 3 — +порядок прокачки. Старые файлы перечитываются из Steam один раз.
const ME_CACHE_V = 3;
const ME_OFFSETS = ['0', '20', '40', '60', '80', '100', '120', '140', '160', '180', '200', '220', '240', '260', '280',
                    '300', '320', '340', '360', '380', '400', '420', '440', '460', '480'];   // до 500 матчей (предел Steam)
const ME_HIST_CALLS = 5;               // GetMatchHistory отдаёт до 100 матчей за вызов

final class SteamError extends RuntimeException {
  public string $kind;                 // timeout | rate_limited | upstream_error | budget
  public function __construct(string $kind) { parent::__construct('steam: ' . $kind); $this->kind = $kind; }
}

function stripSecrets(string $s): string { return (string)preg_replace('/key=[^&\s"\']*/i', 'key=***', $s); }

function steamDir(): string {
  $d = dataDir() . '/cache/steam';
  if (!is_dir($d . '/m')) @mkdir($d . '/m', 0700, true);
  return $d;
}
function steamKey(): string {
  $k = trim((string)@file_get_contents(dataDir() . '/secrets/steam-api-key.txt'));
  return preg_match('/^[A-Za-z0-9]{16,64}$/', $k) ? $k : '';
}

// 1..4294967294 (32-бит) или 17 цифр 7656119… (64-бит). Иначе null.
function parseAccountId(string $raw): ?int {
  if (preg_match('/^\d{1,10}$/', $raw)) $n = (int)$raw;
  elseif (preg_match('/^7656119\d{10}$/', $raw)) $n = (int)$raw - STEAM64_BASE;
  else return null;
  return ($n >= 1 && $n <= 4294967294) ? $n : null;
}

function readJsonFile(string $f) {
  if (!is_file($f)) return null;
  return json_decode((string)@file_get_contents($f), true);
}
function writeJsonFile(string $f, $v): void {
  $tmp = $f . '.' . getmypid() . '.tmp';
  if (@file_put_contents($tmp, json_encode($v, JSON_UNESCAPED_SLASHES), LOCK_EX) !== false) @rename($tmp, $f);
}

// Состояние одного запроса: срок, занятый слот.
final class SteamCtx {
  public float $deadline;
  public $slot = null;
  public function __construct() { $this->deadline = microtime(true) + STEAM_TOTAL_TIMEOUT; }
  public function left(): float { return $this->deadline - microtime(true); }
}

// Занять один из слотов. false — все заняты.
function steamAcquire(SteamCtx $c): bool {
  if ($c->slot) return true;
  for ($i = 0; $i < STEAM_SLOTS; $i++) {
    $h = @fopen(steamDir() . "/slot-$i.lock", 'c');
    if ($h && flock($h, LOCK_EX | LOCK_NB)) { $c->slot = $h; return true; }
    if ($h) fclose($h);
  }
  return false;
}

// Суточный счётчик вызовов (по времени сервера). false — бюджет исчерпан.
function steamSpend(?string $file = null, int $cap = STEAM_DAILY_BUDGET): bool {
  $h = @fopen($file ?? steamDir() . '/budget.json', 'c+');
  if (!$h) return true;                                   // счётчик недоступен — не блокируем сайт
  flock($h, LOCK_EX);
  $b = json_decode((string)stream_get_contents($h), true);
  $day = date('Ymd');
  $n = (is_array($b) && ($b['day'] ?? '') === $day) ? (int)$b['n'] : 0;
  $ok = $n < $cap;
  if ($ok) {
    ftruncate($h, 0); rewind($h);
    fwrite($h, json_encode(['day' => $day, 'n' => $n + 1]));
    fflush($h);
  }
  flock($h, LOCK_UN); fclose($h);
  return $ok;
}

function steamCall(SteamCtx $c, string $method, array $params): array {
  $left = $c->left();
  if ($left < 1) throw new SteamError('timeout');
  $key = steamKey();
  if ($key === '') throw new SteamError('upstream_error');
  if (!steamSpend()) throw new SteamError('budget');
  $url = STEAM_API . '/' . $method . '/v1/?' . http_build_query($params + ['key' => $key]);
  $ch = curl_init($url);
  $t = (int)max(1, min(STEAM_CALL_TIMEOUT, floor($left)));
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $t, CURLOPT_CONNECTTIMEOUT => min(5, $t),
    CURLOPT_USERAGENT => 'dotamate.ru', CURLOPT_HTTPHEADER => ['Accept: application/json'],
  ]);
  $body = curl_exec($ch);
  $errno = curl_errno($ch);
  $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  curl_close($ch);
  unset($url, $key);
  if ($errno === CURLE_OPERATION_TIMEDOUT) throw new SteamError('timeout');
  if ($code === 429) throw new SteamError('rate_limited');
  if ($errno || $code !== 200 || !is_string($body)) throw new SteamError('upstream_error');
  $j = json_decode($body, true);
  if (!is_array($j) || !is_array($j['result'] ?? null)) throw new SteamError('upstream_error');
  return $j['result'];
}

// Список матчей: одним вызовом 100 последних, раскладываем в hist-<id>-<offset>.json.
function meHistory(SteamCtx $c, int $id, string $offset): array {
  $f = steamDir() . "/hist-$id-$offset.json";
  if (is_file($f) && time() - filemtime($f) < STEAM_HIST_TTL) {
    $v = readJsonFile($f);
    if (is_array($v)) return $v;
  }
  if (!steamAcquire($c)) throw new SteamError('busy');
  // До 500 матчей: страницы по 100, следующая — от match_id на 1 меньше последнего (start_at_match_id включительно).
  $rows = []; $seen = []; $total = 0; $start = null; $now = time();
  for ($call = 0; $call < ME_HIST_CALLS; $call++) {
    $q = ['account_id' => $id, 'matches_requested' => 100];
    if ($start !== null) $q['start_at_match_id'] = $start;
    try { $r = steamCall($c, 'GetMatchHistory', $q); }
    catch (SteamError $e) { if ($call === 0) throw $e; break; }   // первые 100 уже есть — отдаём что успели
    $status = (int)($r['status'] ?? 0);
    if ($call === 0 && $status === 15) {
      $v = ['closed' => true, 'cachedAt' => $now];
      foreach (ME_OFFSETS as $o) writeJsonFile(steamDir() . "/hist-$id-$o.json", $v);
      return $v;
    }
    if ($status !== 1 || !is_array($r['matches'] ?? null)) { if ($call === 0) throw new SteamError('upstream_error'); break; }
    if ($call === 0) $total = (int)($r['total_results'] ?? 0);
    $last = null;
    foreach ($r['matches'] as $m) {
      if (!is_array($m) || !isset($m['match_id'], $m['match_seq_num']) || isset($seen[(int)$m['match_id']])) continue;
      $seen[(int)$m['match_id']] = true; $last = (int)$m['match_id'];
      $me = null;
      foreach (($m['players'] ?? []) as $p) if ((int)($p['account_id'] ?? -1) === $id) { $me = $p; break; }
      $slot = $me ? (int)($me['player_slot'] ?? 0) : null;
      $rows[] = [
        'matchId' => (int)$m['match_id'], 'seq' => (int)$m['match_seq_num'],
        'start' => (int)($m['start_time'] ?? 0), 'lobbyType' => (int)($m['lobby_type'] ?? 0),
        'heroId' => $me ? (int)($me['hero_id'] ?? 0) : null,
        'slot' => $slot, 'radiant' => $slot === null ? null : $slot < 128,
      ];
    }
    if ($last === null || count($r['matches']) < 100 || (int)($r['results_remaining'] ?? 0) <= 0) break;
    $start = $last - 1;
  }
  $total = min(500, max($total, count($rows)));
  $result = null;
  foreach (ME_OFFSETS as $o) {
    $v = ['total' => $total, 'cachedAt' => $now, 'rows' => array_slice($rows, (int)$o, 20)];
    writeJsonFile(steamDir() . "/hist-$id-$o.json", $v);
    if ($o === $offset) $result = $v;
  }
  return $result;
}

// Подробности матча (бессрочно, только нужные поля всех 10 игроков). null — не получено.
function meMatch(SteamCtx $c, int $matchId, int $seq): ?array {
  $f = steamDir() . "/m/$matchId.json";
  $v = readJsonFile($f);
  // v2 (L2): добавлены denies, tower_damage, hero_healing, level — нужны модели позиций. Старый файл перечитываем один раз.
  if (is_array($v) && ($v['v'] ?? 1) >= ME_CACHE_V) return $v;
  $old = is_array($v) ? $v : null;
  $miss = steamDir() . "/m/$matchId.miss";                 // Steam вернул другой матч — не спрашивать 1 ч
  if (is_file($miss) && time() - filemtime($miss) < STEAM_HIST_TTL) return $old;
  if (!steamAcquire($c)) throw new SteamError('busy');
  $r = steamCall($c, 'GetMatchHistoryBySequenceNum', ['start_at_match_seq_num' => $seq, 'matches_requested' => 1]);
  $m = $r['matches'][0] ?? null;
  if (!is_array($m) || (int)($m['match_id'] ?? 0) !== $matchId) { @touch($miss); return $old; }
  return meStoreMatch($matchId, $m);
}

// Сохранить подробности матча из ответа Steam (только нужные поля всех 10 игроков).
function meStoreMatch(int $matchId, array $m): array {
  $f = steamDir() . "/m/$matchId.json";
  $players = [];
  foreach (($m['players'] ?? []) as $p) {
    $items = [];
    for ($i = 0; $i < 6; $i++) $items[] = (int)($p["item_$i"] ?? 0);
    $players[] = [
      'id' => (int)($p['account_id'] ?? 0), 'slot' => (int)($p['player_slot'] ?? 0), 'hero' => (int)($p['hero_id'] ?? 0),
      'k' => (int)($p['kills'] ?? 0), 'd' => (int)($p['deaths'] ?? 0), 'a' => (int)($p['assists'] ?? 0),
      'gpm' => (int)($p['gold_per_min'] ?? 0), 'xpm' => (int)($p['xp_per_min'] ?? 0),
      'lh' => (int)($p['last_hits'] ?? 0), 'nw' => (int)($p['net_worth'] ?? 0), 'hd' => (int)($p['hero_damage'] ?? 0),
      'dn' => (int)($p['denies'] ?? 0), 'td' => (int)($p['tower_damage'] ?? 0), 'hh' => (int)($p['hero_healing'] ?? 0), 'lvl' => (int)($p['level'] ?? 0),
      'items' => $items,
      // Порядок прокачки (id способностей и талантов Valve) — первые 25 повышений.
      'ab' => array_slice(array_map(fn($u) => (int)($u['ability'] ?? 0), is_array($p['ability_upgrades'] ?? null) ? $p['ability_upgrades'] : []), 0, 25),
    ];
  }
  $v = ['v' => ME_CACHE_V, 'duration' => (int)($m['duration'] ?? 0), 'gameMode' => (int)($m['game_mode'] ?? 0),
        'radiantWin' => !empty($m['radiant_win']), 'players' => $players];
  writeJsonFile($f, $v);
  return $v;
}

// Нужно ли спрашивать матч у Steam: нет файла v2 и нет свежей отметки «Steam вернул другой матч».
function meNeedFetch(int $matchId): bool {
  $v = readJsonFile(steamDir() . "/m/$matchId.json");
  if (is_array($v) && ($v['v'] ?? 1) >= ME_CACHE_V) return false;
  $miss = steamDir() . "/m/$matchId.miss";
  return !(is_file($miss) && time() - filemtime($miss) < STEAM_HIST_TTL);
}

// Подробности матчей страницы — параллельно пачками по STEAM_PARALLEL (curl_multi). Что не успели — дочитает meMatch по одному.
function mePrefetch(SteamCtx $c, array $rows): void {
  $need = array_values(array_filter($rows, fn($r) => meNeedFetch((int)$r['matchId'])));
  if (!$need || !steamAcquire($c)) return;
  $key = steamKey();
  if ($key === '') return;
  foreach (array_chunk($need, STEAM_PARALLEL) as $chunk) {
    $left = $c->left();
    if ($left < 2) return;
    $t = (int)max(1, min(STEAM_CALL_TIMEOUT, floor($left)));
    $mh = curl_multi_init(); $hs = [];
    foreach ($chunk as $r) {
      if (!steamSpend()) break;
      $ch = curl_init(STEAM_API . '/GetMatchHistoryBySequenceNum/v1/?' . http_build_query(['start_at_match_seq_num' => $r['seq'], 'matches_requested' => 1, 'key' => $key]));
      curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $t, CURLOPT_CONNECTTIMEOUT => min(5, $t),
        CURLOPT_USERAGENT => 'dotamate.ru', CURLOPT_HTTPHEADER => ['Accept: application/json']]);
      curl_multi_add_handle($mh, $ch); $hs[] = [$ch, $r];
    }
    do { $st = curl_multi_exec($mh, $run); if ($run) curl_multi_select($mh, 1.0); } while ($run && $st === CURLM_OK);
    $limited = false;
    foreach ($hs as [$ch, $r]) {
      $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
      $body = curl_multi_getcontent($ch);
      curl_multi_remove_handle($mh, $ch); curl_close($ch);
      if ($code === 429) { $limited = true; continue; }
      if ($code !== 200 || !is_string($body)) continue;
      $j = json_decode($body, true);
      $m = $j['result']['matches'][0] ?? null;
      if (!is_array($m) || (int)($m['match_id'] ?? 0) !== (int)$r['matchId']) { @touch(steamDir() . '/m/' . $r['matchId'] . '.miss'); continue; }
      meStoreMatch((int)$r['matchId'], $m);
    }
    curl_multi_close($mh);
    unset($key);
    if ($limited) return;                                       // Steam просит притормозить — остальное по одному
    $key = steamKey();
  }
}

// Предел объёма кеша: не чаще раза в 10 минут; старые файлы матчей удаляются по mtime до 90 %.
function steamPruneCache(): void {
  $mark = steamDir() . '/prune.mark';
  if (is_file($mark) && time() - filemtime($mark) < 600) return;
  @touch($mark);
  $files = []; $size = 0;
  foreach ([steamDir(), steamDir() . '/m'] as $dir) {
    foreach ((array)@scandir($dir) as $n) {
      if (!preg_match('/^(hist-\d+-\d+\.json|\d+\.json|\d+\.miss)$/', (string)$n)) continue;
      $p = "$dir/$n"; $st = @stat($p);
      if (!$st) continue;
      $files[] = [$st['mtime'], $st['size'], $p]; $size += $st['size'];
    }
  }
  if ($size <= STEAM_CACHE_LIMIT) return;
  usort($files, fn($a, $b) => $a[0] <=> $b[0]);
  foreach ($files as [$mt, $sz, $p]) {
    if ($size <= STEAM_CACHE_LIMIT * 0.9) break;
    if (@unlink($p)) $size -= $sz;
  }
}

function meError(string $code, int $status, int $retry = 0): void {
  if ($retry > 0) header('Retry-After: ' . $retry);
  send(['error' => $code], $status);
}
function meSteamFail(SteamError $e): void {
  switch ($e->kind) {
    case 'busy': meError('busy', 429, 5);
    case 'rate_limited': meError('rate_limited', 429, 60);
    case 'budget': meError('rate_limited', 429, max(60, strtotime('tomorrow') - time()));
    case 'timeout': meError('timeout', 504);
    default: meError('upstream_error', 502);
  }
}

function handlePlayerMatches(string $rawId): void {
  $id = parseAccountId($rawId);
  if ($id === null) meError('bad_id', 400);
  $offset = $_GET['offset'] ?? '0';
  if (!is_string($offset) || !in_array($offset, ME_OFFSETS, true)) meError('bad_offset', 400);
  $tz = filter_var($_GET['tz'] ?? '0', FILTER_VALIDATE_INT, ['options' => ['min_range' => -840, 'max_range' => 840]]);
  if ($tz === false) meError('bad_tz', 400);
  $friend = null;
  if (isset($_GET['friend'])) { $friend = parseAccountId((string)$_GET['friend']); if ($friend === null) meError('bad_friend', 400); }
  if (steamKey() === '') meError('not_configured', 503);

  $c = new SteamCtx();
  try { $h = meHistory($c, $id, $offset); }
  catch (SteamError $e) { meSteamFail($e); }
  if (!empty($h['closed'])) meError('history_unavailable', 403);

  mePrefetch($c, $h['rows']);
  $out = []; $stop = false;
  foreach ($h['rows'] as $row) {
    $d = null;
    if (!$stop) {
      try { $d = meMatch($c, $row['matchId'], $row['seq']); }
      catch (SteamError $e) {                             // таймаут/бюджет/слоты — дальше только кеш
        $stop = true;
        $d = readJsonFile(steamDir() . '/m/' . $row['matchId'] . '.json');
        if (!is_array($d)) $d = null;
      }
    } else {
      $d = readJsonFile(steamDir() . '/m/' . $row['matchId'] . '.json');
      if (!is_array($d)) $d = null;
    }
    $out[] = meRow($row, $d, $id);
  }
  if ($c->slot) { flock($c->slot, LOCK_UN); fclose($c->slot); }
  steamPruneCache();
  // summary=0 — без сводки (промежуточные страницы догрузки); tz — пояс браузера в минутах для «Времени игры».
  $res = ['accountId' => $id, 'offset' => (int)$offset, 'total' => (int)$h['total'], 'cachedAt' => (int)$h['cachedAt'], 'matches' => mePublic($out)];
  if (($_GET['summary'] ?? '1') !== '0') $res['summary'] = meSummary(meCachedRows($id, (int)$offset, $out), $tz, $friend);
  send($res);
}

// --- /me: сводка по загруженным матчам (задача L1) ---
// Считается на сервере из кеша (Steam не вызывается): страницы 0..offset текущего снимка истории.
const ME_MIN_GAMES = 10;               // минимум игр для вывода по герою и для окна тенденции
const ME_TREND_MAX = 20;               // окно тенденции: последние N против предыдущих N
const ME_Z = 1.96;                     // 95 %

// Интервал Уилсона для доли побед, в процентах с одним знаком.
function wilson(int $w, int $n, float $z = ME_Z): array {
  if ($n <= 0) return [0.0, 0.0];
  $p = $w / $n; $z2 = $z * $z;
  $den = 1 + $z2 / $n;
  $c = $p + $z2 / (2 * $n);
  $h = $z * sqrt($p * (1 - $p) / $n + $z2 / (4 * $n * $n));
  return [round(max(0, ($c - $h) / $den) * 100, 1), round(min(1, ($c + $h) / $den) * 100, 1)];
}

// Двусторонний z-тест двух долей с объединённой оценкой.
function meTwoProp(int $w1, int $n1, int $w2, int $n2): float {
  if (!$n1 || !$n2) return 0.0;
  $p = ($w1 + $w2) / ($n1 + $n2);
  $se = sqrt($p * (1 - $p) * (1 / $n1 + 1 / $n2));
  return $se > 0 ? round(($w1 / $n1 - $w2 / $n2) / $se, 2) : 0.0;
}

// --- Оценка позиции игрока (порт tools/match-positions.js; модель data/position-model.json, claude/steam-U2-itog.md) ---
// Позиции 1, 2, 3 и «саппорт» (4 и 5 по итоговой статистике почти не различимы). Это оценка, а не данные Steam.
const POS_NUM = ['gpm', 'xpm', 'nw', 'lh', 'dn', 'hd', 'td', 'hh', 'k', 'd', 'a', 'lvl'];
const POS_NF_DENSE = 35;
function posModel(): ?array {
  static $m = false;
  if ($m !== false) return $m;
  $j = json_decode((string)@file_get_contents(webroot() . '/data/position-model.json'), true);
  if (!is_array($j) || ($j['features']['nfDense'] ?? 0) !== POS_NF_DENSE || ($j['features']['num'] ?? []) !== POS_NUM
      || count($j['weights'] ?? []) !== 5) return $m = null;
  $prior = [];
  foreach ($j['features']['heroPos'] as $h => $c) {
    $s = array_sum($c);
    $prior[(int)$h] = array_map(fn($x) => log(($x + 1) / ($s + 5)) / 3, $c);
  }
  $t = $j['metrics']['test'] ?? [];
  return $m = ['W' => $j['weights'], 'items' => array_flip($j['features']['items']), 'prior' => $prior,
               'zero' => array_fill(0, 5, log(1 / 5) / 3), 'perPos' => $t['perPos'] ?? null, 'coreSup' => $t['coreSup'] ?? null];
}
function posPerms(): array {
  static $out = null;
  if ($out !== null) return $out;
  $out = [];
  $go = function (array $a, array $rest) use (&$go, &$out) {
    if (!$rest) { $out[] = $a; return; }
    foreach ($rest as $i => $v) { $r = $rest; unset($r[$i]); $go(array_merge($a, [$v]), array_values($r)); }
  };
  $go([], [0, 1, 2, 3, 4]);
  return $out;
}
// $team — 5 игроков в порядке слотов (поля кеша v2). → [['pos' => 1|2|3|'sup', 'p' => float] × 5] или null.
function posTeam(array $team): ?array {
  $M = posModel();
  if (!$M || count($team) !== 5) return null;
  foreach ($team as $p) foreach (POS_NUM as $k) if (!isset($p[$k])) return null;
  $sums = []; foreach (POS_NUM as $k) $sums[$k] = array_sum(array_column($team, $k));
  $P = [];
  foreach ($team as $slot => $p) {
    $x = [];
    foreach (POS_NUM as $k) {
      $v = $p[$k]; $gt = 0;
      foreach ($team as $q) if ($q[$k] > $v) $gt++;
      $x[] = $gt / 4;
      $x[] = $sums[$k] ? $v / $sums[$k] * 5 - 1 : 0;
    }
    foreach ($M['prior'][(int)$p['hero']] ?? $M['zero'] as $v) $x[] = $v;
    for ($i = 0; $i < 5; $i++) $x[] = $i === $slot ? 1 : 0;
    $x[] = 1;
    $sp = [];
    foreach (array_unique($p['items']) as $it) if (isset($M['items'][$it])) $sp[] = POS_NF_DENSE + $M['items'][$it];
    $z = [];
    foreach ($M['W'] as $w) { $s = 0.0; for ($j = 0; $j < POS_NF_DENSE; $j++) $s += $w[$j] * $x[$j]; foreach ($sp as $j) $s += $w[$j]; $z[] = $s; }
    $mx = max($z); $e = array_map(fn($v) => exp($v - $mx), $z); $S = array_sum($e);
    $P[] = array_map(fn($v) => $v / $S, $e);
  }
  $L = array_map(fn($r) => array_map(fn($v) => log($v + 1e-12), $r), $P);
  $best = null; $bs = -INF;
  foreach (posPerms() as $pm) {
    $s = $L[0][$pm[0]] + $L[1][$pm[1]] + $L[2][$pm[2]] + $L[3][$pm[3]] + $L[4][$pm[4]];
    if ($s > $bs) { $bs = $s; $best = $pm; }
  }
  $out = [];
  foreach ($best as $i => $c) $out[] = $c < 3 ? ['pos' => $c + 1, 'p' => $P[$i][$c]] : ['pos' => 'sup', 'p' => $P[$i][3] + $P[$i][4]];
  return $out;
}

// Строка матча контракта из записи истории и подробностей (или null).
// Поля с «_» — служебные для сводки (союзники, соперники), в ответ не попадают.
function meRow(array $row, ?array $d, int $id): array {
  $p = null;
  if ($d) foreach ($d['players'] as $pp) {
    if ($pp['id'] === $id || ($row['slot'] !== null && $pp['slot'] === $row['slot'])) { $p = $pp; break; }
  }
  $ok = $d !== null && $p !== null;
  $radiant = $row['radiant'] ?? ($p ? $p['slot'] < 128 : null);
  $pos = null; $al = []; $en = []; $ala = []; $ena = [];
  if ($ok && $radiant !== null) {
    $mine = [];
    foreach ($d['players'] as $q) {
      if (($q['slot'] < 128) === $radiant) { $mine[] = $q; if ($q !== $p) { if ($q['hero'] > 0) $al[] = $q['hero']; $ala[] = $q['id']; } }
      else { if ($q['hero'] > 0) $en[] = $q['hero']; $ena[] = $q['id']; }
    }
    usort($mine, fn($a, $b) => $a['slot'] <=> $b['slot']);
    $lab = posTeam($mine);
    if ($lab) foreach ($mine as $i => $q) if ($q === $p) $pos = $lab[$i];
  }
  return [
    'matchId' => $row['matchId'], 'start' => $row['start'],
    'duration' => $ok ? $d['duration'] : null, 'gameMode' => $ok ? $d['gameMode'] : null,
    'lobbyType' => $row['lobbyType'], 'heroId' => $row['heroId'] ?? ($p['hero'] ?? null), 'radiant' => $radiant,
    'win' => $ok && $radiant !== null ? ($d['radiantWin'] === $radiant) : null,
    'k' => $ok ? $p['k'] : null, 'd' => $ok ? $p['d'] : null, 'a' => $ok ? $p['a'] : null,
    'gpm' => $ok ? $p['gpm'] : null, 'xpm' => $ok ? $p['xpm'] : null, 'lastHits' => $ok ? $p['lh'] : null,
    'netWorth' => $ok ? $p['nw'] : null, 'heroDamage' => $ok ? $p['hd'] : null, 'items' => $ok ? $p['items'] : null,
    'pos' => $pos ? $pos['pos'] : null, 'posP' => $pos ? round($pos['p'], 2) : null,
    'details' => $ok, '_al' => $al, '_en' => $en, '_ala' => $ala, '_ena' => $ena, '_ab' => $ok ? ($p['ab'] ?? null) : null,
  ];
}
function mePublic(array $rows): array {
  return array_map(fn($r) => array_filter($r, fn($k) => $k[0] !== '_', ARRAY_FILTER_USE_KEY), $rows);
}

// Матчи страниц 0..$upto из кеша; $current — уже собранная страница $upto (чтобы не читать её второй раз).
function meCachedRows(int $id, int $upto, ?array $current = null): array {
  $rows = [];
  foreach (ME_OFFSETS as $o) {
    if ((int)$o > $upto) break;
    if ((int)$o === $upto && $current !== null) { $rows = array_merge($rows, $current); break; }
    $h = readJsonFile(steamDir() . "/hist-$id-$o.json");
    if (!is_array($h) || !is_array($h['rows'] ?? null)) break;
    foreach ($h['rows'] as $row) {
      $d = readJsonFile(steamDir() . '/m/' . $row['matchId'] . '.json');
      $rows[] = meRow($row, is_array($d) ? $d : null, $id);
    }
  }
  return $rows;
}

// Сыгранный матч: есть подробности, итог, герой и длительность (лобби без игры Steam отдаёт с hero 0 и duration 0).
function mePlayed(array $m): bool {
  return $m['details'] === true && is_bool($m['win']) && (int)$m['heroId'] > 0 && (int)$m['duration'] > 0;
}

function meAgg(array $ms): array {
  $n = count($ms); $w = 0; $k = 0; $d = 0; $a = 0; $g = 0; $x = 0;
  foreach ($ms as $m) { if ($m['win']) $w++; $k += $m['k']; $d += $m['d']; $a += $m['a']; $g += $m['gpm']; $x += $m['xpm']; }
  if (!$n) return ['games' => 0, 'wins' => 0, 'wr' => null, 'ci' => null, 'k' => null, 'd' => null, 'a' => null, 'kda' => null, 'gpm' => null, 'xpm' => null];
  return [
    'games' => $n, 'wins' => $w, 'wr' => round($w / $n * 100, 1), 'ci' => wilson($w, $n),
    'k' => round($k / $n, 1), 'd' => round($d / $n, 1), 'a' => round($a / $n, 1),
    'kda' => round(($k + $a) / max(1, $d), 2), 'gpm' => (int)round($g / $n), 'xpm' => (int)round($x / $n),
  ];
}
// Только игры/победы/винрейт/интервал.
function meWr(int $w, int $n): array {
  return ['games' => $n, 'wins' => $w, 'wr' => $n ? round($w / $n * 100, 1) : null, 'ci' => $n ? wilson($w, $n) : null];
}

const ME_TURBO = 23;                   // game_mode Turbo
const ME_RANKED_LOBBY = 7;             // lobby_type рейтинговой игры
const ME_MODES = ['all', 'ranked', 'normal', 'turbo'];
const ME_PAIR_MIN = 5;                 // минимум игр для союзника/соперника и героя в «Предметах»
const ME_SESSION_GAP = 7200;           // «после победы/поражения»: следующая игра начата не позже 2 ч после конца предыдущей
const ME_DUR = [['lt25', 0, 1500], ['25_35', 1500, 2100], ['35_45', 2100, 2700], ['gt45', 2700, PHP_INT_MAX]];
function meIsTurbo(array $m): bool { return (int)$m['gameMode'] === ME_TURBO; }
// Категория матча: ranked — рейтинговый (lobby 7, не Turbo), turbo — Turbo, normal — всё остальное.
function meKind(array $m): string { return meIsTurbo($m) ? 'turbo' : ((int)$m['lobbyType'] === ME_RANKED_LOBBY ? 'ranked' : 'normal'); }

function meStatsJson(): array {
  static $j = null;
  if ($j === null) { $j = json_decode((string)@file_get_contents(webroot() . '/data/stats.json'), true); if (!is_array($j)) $j = []; }
  return $j;
}
function meStats(): array {                                        // data/stats.json: винрейт героя по длительности
  static $s = null;
  if ($s === null) { $s = []; foreach ((meStatsJson()['heroes'] ?? []) as $h) $s[(int)$h['id']] = $h['dur'] ?? []; }
  return $s;
}
// stats.json positions: позиция → герой → {n, wr, lo, gpm, xpm}; 'sup' — 4 и 5 вместе (среднее, взвешенное по n).
function mePosBase(): array {
  static $b = null;
  if ($b !== null) return $b;
  $b = ['1' => [], '2' => [], '3' => [], 'sup' => []];
  foreach ((meStatsJson()['positions'] ?? []) as $p => $x) {
    $k = in_array((string)$p, ['4', '5'], true) ? 'sup' : (string)$p;
    if (!isset($b[$k])) continue;
    foreach (($x['heroes'] ?? []) as $h) {
      $id = (int)$h['id']; $n = (int)$h['n'];
      if (!isset($b[$k][$id])) { $b[$k][$id] = ['n' => 0, 'w' => 0.0, 'g' => 0.0, 'x' => 0.0, 'lo' => (float)$h['lo'], 'kn' => 0, 'k' => 0.0, 'd' => 0.0, 'a' => 0.0, 'hd' => 0.0, 'lh' => 0.0]; }
      $c = &$b[$k][$id];
      $c['n'] += $n; $c['w'] += $h['wr'] * $n; $c['g'] += $h['gpm'] * $n; $c['x'] += $h['xpm'] * $n; $c['lo'] = max($c['lo'], (float)$h['lo']);
      if (isset($h['k'], $h['d'], $h['a'], $h['hd'], $h['lh'])) {     // поля K/D/A, урон, добивания — в stats.json с 08.10.2026
        $c['kn'] += $n; $c['k'] += $h['k'] * $n; $c['d'] += $h['d'] * $n; $c['a'] += $h['a'] * $n; $c['hd'] += $h['hd'] * $n; $c['lh'] += $h['lh'] * $n;
      }
      unset($c);
    }
  }
  foreach ($b as $k => $hs) foreach ($hs as $id => $c)
    $b[$k][$id] = ['n' => $c['n'], 'wr' => round($c['w'] / $c['n'], 1), 'lo' => $c['lo'], 'gpm' => (int)round($c['g'] / $c['n']), 'xpm' => (int)round($c['x'] / $c['n'])]
      + ($c['kn'] ? ['k' => round($c['k'] / $c['kn'], 1), 'd' => round($c['d'] / $c['kn'], 1), 'a' => round($c['a'] / $c['kn'], 1), 'hd' => (int)round($c['hd'] / $c['kn']), 'lh' => (int)round($c['lh'] / $c['kn'])] : []);
  return $b;
}
function meItemsMeta(): array {                                    // id → [название, картинка, категория]
  static $m = null;
  if ($m === null) { $j = json_decode((string)@file_get_contents(webroot() . '/data/items-ru.json'), true); $m = [];
    foreach (($j['items'] ?? []) as $slug => $it) if (isset($it['id'])) $m[(int)$it['id']] = [(string)($it['dname'] ?? $slug), (string)($it['img'] ?? ''), (string)($it['cat'] ?? ''), $slug]; }
  return $m;
}
function meSiteItems(): array {                                    // data/hero-items.json: герой → частые покупки
  static $m = null;
  if ($m === null) { $j = json_decode((string)@file_get_contents(webroot() . '/data/hero-items.json'), true); $m = is_array($j['heroes'] ?? null) ? $j['heroes'] : (is_array($j) ? $j : []); }
  return $m;
}

// Сводка по всем играм + scopes.ranked / normal / turbo (те же поля, без вложенных scopes).
// Средний винрейт героя на сайте — по рейтинговым играм, поэтому сравнивать с ним можно только scopes.ranked.
// $tz — смещение пояса браузера в минутах (Date.getTimezoneOffset: UTC − местное).
function meSummary(array $rows, int $tz = 0, ?int $friend = null): array {
  $pl = array_values(array_filter($rows, 'mePlayed'));
  $ctx = ['tz' => $tz, 'items' => [], 'abil' => []];
  $s = meScope($pl, $ctx);
  if ($friend !== null) {                                          // игры с другом: в вашей команде и против
    $tog = array_values(array_filter($pl, fn($m) => in_array($friend, $m['_ala'], true)));
    $vs = array_values(array_filter($pl, fn($m) => in_array($friend, $m['_ena'], true)));
    $s['friend'] = ['id' => $friend, 'together' => meAgg($tog), 'against' => meWr(count(array_filter($vs, fn($m) => $m['win'])), count($vs))];
  }
  $s['matches'] = count($rows);
  $s['modes'] = []; $s['scopes'] = [];
  foreach (['ranked', 'normal', 'turbo'] as $k) {
    $part = array_values(array_filter($pl, fn($m) => meKind($m) === $k));
    $s['modes'][$k] = count($part);
    $s['scopes'][$k] = meScope($part, $ctx);
  }
  $M = posModel();
  $s['posModel'] = $M ? ['perPos' => array_slice((array)$M['perPos'], 0, 3), 'coreSup' => $M['coreSup']] : null;
  $ai = meAbilityIndex(); $s['abilityMeta'] = [];
  foreach (array_keys($ctx['abil'] ?? []) as $aid) if (isset($ai[(string)$aid])) $s['abilityMeta'][$aid] = [(string)$ai[(string)$aid]['title'], (string)$ai[(string)$aid]['name'], !empty($ai[(string)$aid]['isTalent'])];
  $meta = meItemsMeta(); $s['itemMeta'] = [];
  foreach (array_keys($ctx['items']) as $iid) if (isset($meta[$iid])) $s['itemMeta'][$iid] = [$meta[$iid][0], $meta[$iid][1], $meta[$iid][3]];
  $s['tz'] = $tz;
  return $s;
}

function meScope(array $pl, array &$ctx): array {                // $pl — сыгранные, новые первыми
  $all = meAgg($pl);
  $by = [];
  foreach ($pl as $m) $by[(int)$m['heroId']][] = $m;
  $heroes = [];
  foreach ($by as $hid => $ms) $heroes[] = ['heroId' => $hid, 'unranked' => count(array_filter($ms, fn($m) => meKind($m) !== 'ranked'))] + meAgg($ms);
  usort($heroes, fn($a, $b) => [$b['games'], $b['wins'], $a['heroId']] <=> [$a['games'], $a['wins'], $b['heroId']]);
  $n = min(ME_TREND_MAX, intdiv(count($pl), 2));
  $trend = null;
  if ($n >= ME_MIN_GAMES) {
    $r = meAgg(array_slice($pl, 0, $n)); $q = meAgg(array_slice($pl, $n, $n));
    $z = meTwoProp($r['wins'], $n, $q['wins'], $n);
    $trend = ['n' => $n, 'recent' => $r, 'previous' => $q, 'z' => $z, 'sig' => abs($z) > ME_Z];
  }
  $chron = array_reverse($pl);                                    // старые первыми
  // Серия и игры после победы/поражения в пределах одной сессии.
  $streak = null;
  if ($pl) { $t = $pl[0]['win']; $k = 0; foreach ($pl as $m) { if ($m['win'] !== $t) break; $k++; } $streak = ['win' => $t, 'n' => $k]; }
  $aw = [0, 0]; $al = [0, 0];
  for ($i = 1; $i < count($chron); $i++) {
    $a = $chron[$i - 1]; $b = $chron[$i];
    $gap = $b['start'] - ($a['start'] + $a['duration']);
    if ($gap < -300 || $gap > ME_SESSION_GAP) continue;
    if ($a['win']) { $aw[1]++; if ($b['win']) $aw[0]++; } else { $al[1]++; if ($b['win']) $al[0]++; }
  }
  $z = meTwoProp($aw[0], $aw[1], $al[0], $al[1]);
  $after = ['afterWin' => meWr($aw[0], $aw[1]), 'afterLoss' => meWr($al[0], $al[1]), 'z' => $z,
            'sig' => $aw[1] >= ME_MIN_GAMES && $al[1] >= ME_MIN_GAMES && abs($z) > ME_Z, 'gap' => ME_SESSION_GAP];
  // Союзники и соперники.
  $pair = function (string $key) use ($pl, $all) {
    $c = [];
    foreach ($pl as $m) foreach ($m[$key] as $h) { $c[$h] = $c[$h] ?? [0, 0]; $c[$h][1]++; if ($m['win']) $c[$h][0]++; }
    $out = [];
    foreach ($c as $h => [$w, $g]) if ($g >= ME_PAIR_MIN) {
      $x = ['heroId' => $h] + meWr($w, $g);
      $x['sig'] = $all['wr'] !== null && ($x['ci'][0] > $all['wr'] || $x['ci'][1] < $all['wr']);
      $out[] = $x;
    }
    usort($out, fn($a, $b) => [$b['games'], $a['heroId']] <=> [$a['games'], $b['heroId']]);
    return $out;
  };
  // Позиции (оценка модели).
  $pos = []; $unknown = 0;
  foreach ($pl as $m) { if ($m['pos'] === null) { $unknown++; continue; } $pos[(string)$m['pos']][] = $m; }
  $positions = [];
  foreach (['1', '2', '3', 'sup'] as $k) if (!empty($pos[$k])) $positions[] = ['pos' => $k] + meAgg($pos[$k]);
  // Длительность: ваш винрейт и ожидаемый по средним винрейтам ваших героев в играх той же длины (data/stats.json).
  $st = meStats(); $dur = [];
  foreach (ME_DUR as [$key, $lo, $hi]) {
    $ms = array_filter($pl, fn($m) => $m['duration'] >= $lo && $m['duration'] < $hi);
    $w = 0; $e = 0; $ne = 0;
    foreach ($ms as $m) { if ($m['win']) $w++; $hw = $st[(int)$m['heroId']][$key][1] ?? null; if ($hw !== null) { $e += $hw; $ne++; } }
    $dur[] = ['key' => $key] + meWr($w, count($ms)) + ['exp' => $ne ? round($e / $ne, 1) : null];
  }
  // Время суток и день недели по поясу браузера.
  $per = array_fill(0, 4, [0, 0]); $wd = array_fill(0, 7, [0, 0]);
  foreach ($pl as $m) {
    $t = $m['start'] - $ctx['tz'] * 60;
    $p = intdiv((int)gmdate('G', $t), 6); $d = (int)gmdate('N', $t) - 1;
    $per[$p][1]++; $wd[$d][1]++;
    if ($m['win']) { $per[$p][0]++; $wd[$d][0]++; }
  }
  $mark = function (array $x) use ($all) { $x['sig'] = $x['games'] >= ME_MIN_GAMES && $all['wr'] !== null && ($x['ci'][0] > $all['wr'] || $x['ci'][1] < $all['wr']); return $x; };
  $time = ['periods' => array_map(fn($x) => $mark(meWr($x[0], $x[1])), $per), 'weekdays' => array_map(fn($x) => $mark(meWr($x[0], $x[1])), $wd)];
  // Предметы на частых героях: ваши итоговые предметы (только законченные, категория item) и что собирают на сайте.
  $meta = meItemsMeta(); $site = meSiteItems(); $items = [];
  foreach (array_slice(array_filter($heroes, fn($h) => $h['games'] >= ME_PAIR_MIN), 0, 5) as $h) {
    $c = [];
    foreach ($by[$h['heroId']] as $m) foreach (array_unique((array)$m['items']) as $it)
      if ($it > 0 && ($meta[$it][2] ?? '') === 'item') { $c[$it] = $c[$it] ?? [0, 0]; $c[$it][1]++; if ($m['win']) $c[$it][0]++; }
    uasort($c, fn($a, $b) => $b[1] <=> $a[1]);
    $mine = [];
    foreach (array_slice($c, 0, 8, true) as $it => [$w, $g]) { $mine[] = ['id' => $it, 'share' => round($g / $h['games'] * 100), 'wins' => $w, 'games' => $g]; $ctx['items'][$it] = 1; }
    $sg = []; $sh = $site[(string)$h['heroId']] ?? null; $sn = (int)($sh['n'] ?? 0);
    if ($sn) foreach (['mid', 'late', 'vlate'] as $ph) foreach (($sh[$ph] ?? []) as $x)
      if (($meta[(int)$x['i']][2] ?? '') === 'item') $sg[(int)$x['i']] = max($sg[(int)$x['i']] ?? 0, (int)$x['g']);
    arsort($sg);
    $siteTop = [];
    foreach (array_slice($sg, 0, 6, true) as $it => $g) { $siteTop[] = ['id' => $it, 'share' => round($g / $sn * 100)]; $ctx['items'][$it] = 1; }
    $items[] = ['heroId' => $h['heroId'], 'games' => $h['games'], 'mine' => $mine, 'site' => $siteTop];
  }
  return ['all' => $all, 'heroes' => $heroes, 'trend' => $trend, 'minGames' => ME_MIN_GAMES, 'z' => ME_Z,
          'streak' => $streak, 'after' => $after, 'vs' => $pair('_en'), 'with' => $pair('_al'),
          'positions' => $positions, 'posUnknown' => $unknown, 'dur' => $dur, 'time' => $time, 'items' => $items,
          'series' => array_map(fn($m) => [$m['start'], $m['win'] ? 1 : 0, $m['gpm'], $m['xpm']], $chron)]
         + meExtras($pl, $chron, $positions, $by) + ['skills' => meSkills($by, $ctx)];
}

// Критическое значение t (двусторонний 95 %) для df = 1…30, дальше 1,96.
function meTCrit(int $df): float {
  static $t = [12.71, 4.30, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23, 2.20, 2.18, 2.16, 2.14, 2.13, 2.12, 2.11, 2.10, 2.09, 2.09,
               2.08, 2.07, 2.07, 2.06, 2.06, 2.06, 2.05, 2.05, 2.05, 2.04];
  return $df >= 1 && $df <= 30 ? $t[$df - 1] : 1.96;
}

// data/builds/<герой>.json (Stratz, Divine–Immortal): популярный порядок первых 10 повышений по позиции.
function meBuild(int $hero): ?array {
  static $c = [];
  if (array_key_exists($hero, $c)) return $c[$hero];
  $j = json_decode((string)@file_get_contents(webroot() . "/data/builds/$hero.json"), true);
  return $c[$hero] = is_array($j) ? $j : null;
}
function meAbilityIndex(): array {
  static $a = null;
  if ($a === null) { $j = json_decode((string)@file_get_contents(webroot() . '/data/ability-index.json'), true); $a = is_array($j['abilities'] ?? null) ? $j['abilities'] : []; }
  return $a;
}

// Ваш порядок первых 10 повышений на частых героях (самое частое по каждому уровню) против популярного по сборкам сайта.
function meSkills(array $by, array &$ctx): array {
  $out = [];
  foreach ($by as $hid => $ms) {
    $ms = array_values(array_filter($ms, fn($m) => is_array($m['_ab']) && count($m['_ab']) >= 10));
    if (count($ms) < 3) continue;
    $lv = [];
    for ($i = 0; $i < 10; $i++) {
      $cnt = []; foreach ($ms as $m) { $a = $m['_ab'][$i]; $cnt[$a] = ($cnt[$a] ?? 0) + 1; }
      arsort($cnt); $top = array_key_first($cnt);
      $lv[] = ['id' => (int)$top, 'share' => (int)round($cnt[$top] / count($ms) * 100)];
    }
    // Позиция: самая частая ваша на герое; «саппорт» — POSITION_4 или _5, у какой больше матчей в сборках.
    $pc = []; foreach ($ms as $m) if ($m['pos'] !== null) $pc[(string)$m['pos']] = ($pc[(string)$m['pos']] ?? 0) + 1;
    arsort($pc); $pos = $pc ? (string)array_key_first($pc) : null;
    $b = meBuild((int)$hid); $site = null; $pk = null;
    if ($b) {
      $cands = $pos === null ? [] : ($pos === 'sup' ? ['POSITION_4', 'POSITION_5'] : ['POSITION_' . $pos]);
      foreach ($cands as $k) if (isset($b['positions'][$k]) && (!$pk || $b['positions'][$k]['matches'] > $b['positions'][$pk]['matches'])) $pk = $k;
      if (!$pk && !empty($b['positionOrder'][0]) && isset($b['positions'][$b['positionOrder'][0]])) $pk = $b['positionOrder'][0];   // своей позиции в сборках нет — основная позиция героя
      $steps = $pk ? ($b['positions'][$pk]['progression']['popular']['steps'] ?? []) : [];
      if (count($steps) >= 10) $site = array_map(fn($s) => (int)$s['abilityId'], array_slice($steps, 0, 10));
    }
    $same = $site ? count(array_filter(range(0, 9), fn($i) => $lv[$i]['id'] === $site[$i])) : null;
    foreach ($lv as $x) $ctx['abil'][$x['id']] = 1;
    if ($site) foreach ($site as $x) $ctx['abil'][$x] = 1;
    $out[] = ['heroId' => (int)$hid, 'games' => count($ms), 'pos' => $pos, 'sitePos' => $pk ? (int)substr($pk, 9) : null,
              'siteMatches' => $pk ? (int)$b['positions'][$pk]['matches'] : null, 'mine' => $lv, 'site' => $site, 'same' => $same];
  }
  usort($out, fn($x, $y) => [$y['games'], $x['heroId']] <=> [$x['games'], $y['heroId']]);
  return array_slice($out, 0, 6);
}

// Рекорды, неделя, сравнение с базой по герою и позиции, похожие герои.
function meExtras(array $pl, array $chron, array $positions, array $by): array {
  $rec = [];
  $pick = function (string $key, callable $val) use ($pl, &$rec) {
    $best = null; $bv = -INF;
    foreach ($pl as $m) { $v = $val($m); if ($v > $bv) { $bv = $v; $best = $m; } }
    if ($best) $rec[$key] = ['matchId' => $best['matchId'], 'heroId' => $best['heroId'], 'start' => $best['start'], 'win' => $best['win'], 'value' => is_float($bv) ? round($bv, 2) : $bv,
                             'k' => $best['k'], 'd' => $best['d'], 'a' => $best['a']];
  };
  $pick('kda', fn($m) => ($m['k'] + $m['a']) / max(1, $m['d']));
  $pick('kills', fn($m) => $m['k']);
  $pick('gpm', fn($m) => $m['gpm']);
  $pick('damage', fn($m) => $m['heroDamage'] ?? 0);
  $pick('longest', fn($m) => $m['duration']);
  $run = 0; $best = 0; $from = null; $bf = null; $bt = null;
  foreach ($chron as $m) { if ($m['win']) { if (!$run) $from = $m['start']; $run++; if ($run > $best) { $best = $run; $bf = $from; $bt = $m['start']; } } else $run = 0; }
  if ($best) $rec['winStreak'] = ['value' => $best, 'from' => $bf, 'to' => $bt];
  // Неделя: последние 7 суток против предыдущих 7 (от времени запроса).
  $now = time(); $wk = [[], []];
  foreach ($pl as $m) { $age = $now - $m['start']; if ($age < 7 * 86400) $wk[0][] = $m; elseif ($age < 14 * 86400) $wk[1][] = $m; }
  $bestHero = null;
  $hb = []; foreach ($wk[0] as $m) { $h = (int)$m['heroId']; $hb[$h] = $hb[$h] ?? [0, 0]; $hb[$h][1]++; if ($m['win']) $hb[$h][0]++; }
  foreach ($hb as $h => [$w, $g]) if ($g >= 3 && (!$bestHero || [$w / $g, $g] > [$bestHero['wins'] / $bestHero['games'], $bestHero['games']])) $bestHero = ['heroId' => $h] + meWr($w, $g);
  $a = meAgg($wk[0]); $b = meAgg($wk[1]);
  $week = ['now' => $a, 'prev' => $b, 'z' => meTwoProp($a['wins'], $a['games'], $b['wins'], $b['games']), 'bestHero' => $bestHero];
  // Ваши GPM/XPM на герое и позиции против среднего по базе сайта (stats.json positions; ≥3 ваших игр).
  $base = mePosBase(); $grp = [];
  foreach ($pl as $m) if ($m['pos'] !== null) $grp[$m['heroId'] . ':' . $m['pos']][] = $m;
  $cmp = [];
  foreach ($grp as $key => $ms) {
    if (count($ms) < 3) continue;
    [$h, $p] = explode(':', $key);
    $bs = $base[$p][(int)$h] ?? null;
    $ag = meAgg($ms); $n = count($ms);
    $tt = function (string $key, $base) use ($ms, $n) {           // одновыборочный t-тест: ваше среднее против среднего базы
      if ($base === null || $n < 3) return null;
      $mean = array_sum(array_column($ms, $key)) / $n;
      $var = 0.0; foreach ($ms as $m) $var += ($m[$key] - $mean) ** 2; $sd = sqrt($var / ($n - 1));
      if ($sd <= 0) return null;
      $t = ($mean - $base) / ($sd / sqrt($n));
      return ['t' => round($t, 2), 'sig' => abs($t) > meTCrit($n - 1)];
    };
    $cmp[] = ['heroId' => (int)$h, 'pos' => $p, 'games' => $ag['games'], 'wr' => $ag['wr'], 'gpm' => $ag['gpm'], 'xpm' => $ag['xpm'],
              'k' => $ag['k'], 'd' => $ag['d'], 'a' => $ag['a'],
              'hd' => (int)round(array_sum(array_column($ms, 'heroDamage')) / $n), 'lh' => (int)round(array_sum(array_column($ms, 'lastHits')) / $n),
              'baseN' => $bs['n'] ?? null, 'baseGpm' => $bs['gpm'] ?? null, 'baseXpm' => $bs['xpm'] ?? null, 'baseWr' => $bs['wr'] ?? null,
              'baseK' => $bs['k'] ?? null, 'baseD' => $bs['d'] ?? null, 'baseA' => $bs['a'] ?? null, 'baseHd' => $bs['hd'] ?? null, 'baseLh' => $bs['lh'] ?? null,
              'gpmTest' => $tt('gpm', $bs['gpm'] ?? null), 'xpmTest' => $tt('xpm', $bs['xpm'] ?? null)];
  }
  usort($cmp, fn($x, $y) => [$y['games'], $x['heroId']] <=> [$x['games'], $y['heroId']]);
  // Похожие герои: основная позиция (больше всего игр) → лучшие по нижней границе винрейта в базе, кого вы почти не играете (< 3 игр).
  $similar = null;
  if ($positions) {
    $main = $positions[0]; foreach ($positions as $x) if ($x['games'] > $main['games']) $main = $x;
    $list = [];
    foreach ($base[$main['pos']] ?? [] as $id => $x) if (count($by[$id] ?? []) < 3) $list[] = ['heroId' => $id] + $x;
    usort($list, fn($x, $y) => [$y['lo'], $y['n']] <=> [$x['lo'], $x['n']]);
    $similar = ['pos' => $main['pos'], 'share' => $main['games'], 'heroes' => array_slice($list, 0, 6)];
  }
  return ['records' => $rec, 'week' => $week, 'heroCmp' => array_slice($cmp, 0, 12), 'similar' => $similar];
}

// --- /me: разбор матча по клику — только из кеша (матч уже загружали для чьего-то профиля), без Steam ID игроков ---
function handleMatchDetail(string $raw): void {
  $mid = (int)$raw;
  $d = readJsonFile(steamDir() . "/m/$mid.json");
  if (!is_array($d) || $mid <= 0) send(['error' => 'not_cached'], 404);
  $me = isset($_GET['me']) ? parseAccountId((string)$_GET['me']) : null;
  $meta = meItemsMeta(); $im = []; $teams = [true => [], false => []];
  foreach ($d['players'] as $p) $teams[$p['slot'] < 128][] = $p;
  $out = [];
  foreach ([true, false] as $rad) {
    usort($teams[$rad], fn($a, $b) => $a['slot'] <=> $b['slot']);
    $lab = posTeam($teams[$rad]);
    foreach ($teams[$rad] as $i => $p) {
      foreach ($p['items'] as $it) if ($it > 0 && isset($meta[$it])) $im[$it] = [$meta[$it][0], $meta[$it][1], $meta[$it][3]];
      $out[] = ['radiant' => $rad, 'hero' => $p['hero'], 'me' => $me !== null && $p['id'] === $me,
                'k' => $p['k'], 'd' => $p['d'], 'a' => $p['a'], 'gpm' => $p['gpm'], 'xpm' => $p['xpm'], 'lh' => $p['lh'], 'dn' => $p['dn'] ?? null,
                'nw' => $p['nw'], 'hd' => $p['hd'], 'td' => $p['td'] ?? null, 'hh' => $p['hh'] ?? null, 'lvl' => $p['lvl'] ?? null, 'items' => $p['items'],
                'pos' => $lab ? $lab[$i]['pos'] : null, 'posP' => $lab ? round($lab[$i]['p'], 2) : null];
    }
  }
  send(['matchId' => $mid, 'duration' => $d['duration'], 'gameMode' => $d['gameMode'], 'radiantWin' => $d['radiantWin'], 'players' => $out, 'itemMeta' => $im]);
}

// --- /me: карточка результата (только по нажатию «Поделиться»; без Steam ID и номеров матчей) ---
const CARD_DAILY_LIMIT = 500;          // новых карточек в сутки на весь сайт
const CARD_KEEP = 180 * 86400;         // хранение снимка
const CARD_TOP = 3;

function cardDir(): string {
  $d = dataDir() . '/cards';
  if (!is_dir($d)) @mkdir($d, 0700, true);
  return $d;
}
function cardLoad(string $tok): ?array {
  if (!preg_match('/^[a-f0-9]{20}$/', $tok)) return null;
  $f = cardDir() . "/$tok.json";
  if (!is_file($f) || time() - filemtime($f) > CARD_KEEP) return null;
  $v = readJsonFile($f);
  return is_array($v) ? $v : null;
}
function cardHeroNames(): array {
  static $memo = null;
  if ($memo !== null) return $memo;
  $memo = [];
  $j = json_decode((string)@file_get_contents(webroot() . '/data/heroes.json'), true);
  foreach (($j['heroes'] ?? []) as $h) {
    $memo[(int)$h['id']] = ['name' => (string)$h['localized_name'], 'raw' => preg_replace('/^npc_dota_hero_/', '', (string)$h['name'])];
  }
  return $memo;
}

// Данные карточки из кеша (Steam не вызывается). Строка — код ошибки no_data / not_enough.
function cardMode(): string {
  $m = $_GET['mode'] ?? 'all';
  if (!is_string($m) || !in_array($m, ME_MODES, true)) meError('bad_mode', 400);
  return $m;
}
// Подпись режима: «Рейтинговые», «Обычные», «Turbo» или смесь «Рейтинг 40 · Обычные 20 · Turbo 40».
function cardModeLabel(string $mode, array $modes): string {
  $names = ['ranked' => 'Рейтинговые', 'normal' => 'Обычные', 'turbo' => 'Turbo'];
  if ($mode !== 'all') return $names[$mode];
  $have = array_filter($modes);
  if (count($have) === 1) return $names[array_key_first($have)];
  $short = ['ranked' => 'Рейтинг', 'normal' => 'Обычные', 'turbo' => 'Turbo'];
  return implode(' · ', array_map(fn($k) => $short[$k] . ' ' . $have[$k], array_keys($have)));
}

function cardBuild(int $id, string $mode = 'all') {
  $rows = meCachedRows($id, 480);
  if (!$rows) return 'no_data';
  $full = meSummary($rows);
  $s = $mode === 'all' ? $full : $full['scopes'][$mode];
  if ($s['all']['games'] < ME_MIN_GAMES) return 'not_enough';
  $pick = fn($m) => mePlayed($m) && ($mode === 'all' || meKind($m) === $mode);
  $starts = array_values(array_filter(array_map(fn($m) => $pick($m) ? (int)$m['start'] : 0, $rows)));
  $card = [
    'v' => 2, 'created' => time(), 'from' => min($starts), 'to' => max($starts),
    'mode' => $mode, 'modeLabel' => cardModeLabel($mode, $full['modes']),
    'all' => $s['all'],
    'top' => array_map(fn($x) => ['heroId' => $x['heroId'], 'games' => $x['games'], 'wins' => $x['wins'], 'wr' => $x['wr'], 'kda' => $x['kda']], array_slice($s['heroes'], 0, CARD_TOP)),
    'trend' => $s['trend'] ? ['n' => $s['trend']['n'], 'recent' => $s['trend']['recent']['wr'], 'previous' => $s['trend']['previous']['wr'],
                              'sig' => $s['trend']['sig']] : null,
  ];
  return $card;
}

// Превью карточки на странице /me (без сохранения и без ссылки): GET /api/dota/player/<id>/card.png
function handleCardPreview(string $rawId): void {
  $id = parseAccountId($rawId);
  if ($id === null) meError('bad_id', 400);
  $c = cardBuild($id, cardMode());
  if (is_string($c)) meError($c, 409);
  $im = cardRender($c);
  header('Content-Type: image/png');
  header('Cache-Control: no-store');
  imagepng($im, null, 6); imagedestroy($im);
  exit;
}

function handleCardCreate(string $rawId): void {
  if (!in_array($_SERVER['HTTP_ORIGIN'] ?? '', FEEDBACK_ORIGINS, true)) send(['error' => 'forbidden'], 403);
  $id = parseAccountId($rawId);
  if ($id === null) meError('bad_id', 400);
  $card = cardBuild($id, cardMode());
  if (is_string($card)) meError($card, 409);
  // Суточный предел новых карточек.
  $h = @fopen(cardDir() . '/count.json', 'c+');
  if ($h) {
    flock($h, LOCK_EX);
    $b = json_decode((string)stream_get_contents($h), true);
    $day = date('Ymd');
    $cnt = (is_array($b) && ($b['day'] ?? '') === $day) ? (int)$b['n'] : 0;
    if ($cnt >= CARD_DAILY_LIMIT) { flock($h, LOCK_UN); fclose($h); meError('rate_limited', 429, max(60, strtotime('tomorrow') - time())); }
    ftruncate($h, 0); rewind($h); fwrite($h, json_encode(['day' => $day, 'n' => $cnt + 1])); fflush($h);
    flock($h, LOCK_UN); fclose($h);
  }
  $tok = bin2hex(random_bytes(10));
  writeJsonFile(cardDir() . "/$tok.json", $card);
  cardPrune();
  send(['token' => $tok, 'url' => "/me/card/$tok/", 'image' => "/api/dota/card/$tok.png"], 201);
}

// Старше CARD_KEEP — удалить; не чаще раза в сутки.
function cardPrune(): void {
  $mark = cardDir() . '/prune.mark';
  if (is_file($mark) && time() - filemtime($mark) < 86400) return;
  @touch($mark);
  foreach ((array)@scandir(cardDir()) as $n) {
    if (!preg_match('/^[a-f0-9]{20}\.(json|png)$/', (string)$n)) continue;
    $p = cardDir() . "/$n";
    if (time() - (int)@filemtime($p) > CARD_KEEP) @unlink($p);
  }
}

function cardPlural(int $n, string $one, string $few, string $many): string {
  $a = $n % 100; $b = $n % 10;
  return ($a > 10 && $a < 20) ? $many : ($b === 1 ? $one : ($b > 1 && $b < 5 ? $few : $many));
}
function cardFmt1($v): string { return str_replace('.', ',', number_format((float)$v, 1)); }
function cardFmtPct($v): string { return $v === null ? '—' : str_replace('.', ',', number_format((float)$v, 1)) . ' %'; }
function cardDate(int $ts): string {
  static $mon = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  return (int)date('j', $ts) . ' ' . $mon[(int)date('n', $ts) - 1] . ' ' . date('Y', $ts);
}

// PNG 1200×630 (Open Graph). Шрифт DejaVu — в api/fonts (кириллица).
function cardPng(string $tok, array $c): string {
  $f = cardDir() . "/$tok.png";
  if (is_file($f)) return $f;
  $im = cardRender($c);
  imagepng($im, $f . '.tmp', 6); imagedestroy($im);
  @rename($f . '.tmp', $f);
  return $f;
}

function cardRender(array $c) {
  $S = 2; $W = 1200 * $S; $H = 630 * $S;                       // рисуем в 2× и уменьшаем — сглаженные края
  $im = imagecreatetruecolor($W, $H);
  imagealphablending($im, true);
  $rgb = fn($r, $g, $b, $a = 0) => imagecolorallocatealpha($im, $r, $g, $b, $a);
  $white = $rgb(240, 241, 244); $text = $rgb(206, 210, 218); $muted = $rgb(128, 135, 148); $dim = $rgb(88, 94, 106);
  $gold = $rgb(226, 182, 96); $goldSoft = $rgb(112, 92, 56); $line = $rgb(44, 48, 57);
  $panel = $rgb(26, 29, 36); $track = $rgb(42, 46, 55); $green = $rgb(125, 207, 140); $red = $rgb(236, 128, 120);   // непрозрачные: у полупрозрачных скруглений темнеют углы $green = $rgb(125, 207, 140); $red = $rgb(236, 128, 120);
  // Фон: вертикальный градиент и мягкое золотое свечение справа сверху.
  for ($y = 0; $y < $H; $y++) {
    $t = $y / $H;
    imageline($im, 0, $y, $W, $y, $rgb((int)(13 + 8 * $t), (int)(15 + 8 * $t), (int)(19 + 10 * $t)));
  }
  for ($r = 520; $r > 0; $r -= 26) imagefilledellipse($im, (int)(1080 * $S), (int)(-40 * $S), $r * 2 * $S, $r * 2 * $S, $rgb(226, 182, 96, 126));
  $F = __DIR__ . '/fonts/';
  $OS = $F . 'Oswald-SemiBold.ttf'; $MM = $F . 'Manrope-Medium.ttf'; $MB = $F . 'Manrope-Bold.ttf';
  $w = fn($size, $font, $s) => (function ($b) { return $b[2] - $b[0]; })(imagettfbbox($size * $S, 0, $font, $s)) / $S;
  $t = function ($size, $x, $y, $col, $font, $s, $align = 'l') use ($im, $S, $w) {
    if ($align === 'r') $x -= $w($size, $font, $s);
    imagettftext($im, $size * $S, 0, (int)round($x * $S), (int)round($y * $S), $col, $font, $s);
  };
  $box = function ($x1, $y1, $x2, $y2, $r, $col) use ($im, $S) {
    [$x1, $y1, $x2, $y2, $r] = array_map(fn($v) => (int)round($v * $S), [$x1, $y1, $x2, $y2, $r]);
    imagefilledrectangle($im, $x1 + $r, $y1, $x2 - $r, $y2, $col);
    imagefilledrectangle($im, $x1, $y1 + $r, $x1 + $r - 1, $y2 - $r, $col);
    imagefilledrectangle($im, $x2 - $r + 1, $y1 + $r, $x2, $y2 - $r, $col);
    foreach ([[$x1 + $r, $y1 + $r], [$x2 - $r, $y1 + $r], [$x1 + $r, $y2 - $r], [$x2 - $r, $y2 - $r]] as [$cx, $cy])
      imagefilledarc($im, $cx, $cy, $r * 2, $r * 2, 0, 360, $col, IMG_ARC_PIE);
  };
  $a = $c['all'];
  $games = $a['games'] . ' ' . cardPlural($a['games'], 'матч', 'матча', 'матчей');
  // Шапка
  $box(60, 52, 64, 78, 2, $gold);
  $t(22, 76, 76, $white, $OS, 'DOTA MATE');
  $ml = mb_strtoupper((string)($c['modeLabel'] ?? ''));
  if ($ml !== '') {                                              // режим — золотая «таблетка» рядом с логотипом
    $cx = 76 + $w(22, $OS, 'DOTA MATE') + 18; $cw2 = $w(12, $MB, $ml) + 28;
    $box($cx, 52, $cx + $cw2, 80, 14, $gold);
    $box($cx + 1.5, 53.5, $cx + $cw2 - 1.5, 78.5, 12.5, $rgb(30, 27, 22));
    $t(12, $cx + 14, 71, $gold, $MB, $ml);
  }
  $t(14, 1140, 64, $muted, $MB, 'МОЙ ПРОФИЛЬ · ' . mb_strtoupper($games), 'r');
  $t(13, 1140, 86, $dim, $MM, cardDate((int)$c['from']) . ' — ' . cardDate((int)$c['to']), 'r');
  // Винрейт и интервал Уилсона на шкале 0–100 %
  $t(13, 60, 150, $muted, $MB, 'ВИНРЕЙТ');
  $big = cardFmt1($a['wr']);
  $t(92, 56, 256, $white, $OS, $big);
  $t(40, 64 + $w(92, $OS, $big), 256, $gold, $OS, '%');
  $bx = 60; $bw = 480; $by = 290;
  $box($bx, $by, $bx + $bw, $by + 8, 4, $track);
  $box($bx + $bw * $a['ci'][0] / 100, $by, $bx + $bw * $a['ci'][1] / 100, $by + 8, 4, $goldSoft);
  $mx = $bx + $bw * $a['wr'] / 100;
  $box($mx - 3, $by - 6, $mx + 3, $by + 14, 3, $gold);
  imagefilledrectangle($im, (int)(($bx + $bw / 2) * $S), (int)(($by - 4) * $S), (int)(($bx + $bw / 2) * $S + 1), (int)(($by + 12) * $S), $dim);
  $t(12, $bx, $by + 34, $dim, $MM, '0');
  $t(12, $bx + $bw / 2, $by + 34, $dim, $MM, '50', 'l');
  $t(12, $bx + $bw, $by + 34, $dim, $MM, '100', 'r');
  $t(14, 60, 360, $text, $MM, '95 % интервал ' . cardFmt1($a['ci'][0]) . '–' . cardFmt1($a['ci'][1]) . ' %  ·  ' . $a['wins'] . ' ' . cardPlural($a['wins'], 'победа', 'победы', 'побед') . ' из ' . $a['games']);
  // Плитки: K/D/A, KDA, GPM, XPM
  $tiles = [['K / D / A', cardFmt1($a['k']) . ' / ' . cardFmt1($a['d']) . ' / ' . cardFmt1($a['a'])], ['KDA', str_replace('.', ',', number_format((float)$a['kda'], 2))],
            ['GPM', (string)$a['gpm']], ['XPM', (string)$a['xpm']]];
  foreach ($tiles as $i => [$lab, $val]) {
    $x = 640 + ($i % 2) * 254; $y = 128 + intdiv($i, 2) * 104;
    $box($x, $y, $x + 246, $y + 92, 14, $panel);
    $t(12, $x + 20, $y + 32, $muted, $MB, $lab);
    $fs = 30; while ($fs > 18 && $w($fs, $OS, $val) > 206) $fs--;
    $t($fs, $x + 20, $y + 76, $white, $OS, $val);
  }
  if ($c['trend']) {
    $tr = $c['trend']; $d = $tr['recent'] - $tr['previous'];
    $col = $tr['sig'] ? ($d > 0 ? $green : $red) : $muted;
    $msg = 'Последние ' . $tr['n'] . ': ' . cardFmtPct($tr['recent']) . '  ·  до этого ' . cardFmtPct($tr['previous'])
         . '  ·  ' . ($tr['sig'] ? ($d > 0 ? 'рост' : 'спад') : 'в пределах случайности');
    $box(640, 344, 1140, 376, 16, $panel);
    imagefilledellipse($im, (int)(658 * $S), (int)(360 * $S), 8 * $S, 8 * $S, $col);
    if ($w(13, $MM, $msg) > 456) $msg = str_replace('Последние', 'Посл.', $msg);
    $fs = 13; while ($fs > 10 && $w($fs, $MM, $msg) > 456) $fs--;
    $t($fs, 672, 365, $text, $MM, $msg);
  }
  // Частые герои
  imagefilledrectangle($im, 60 * $S, 408 * $S, 1140 * $S, 408 * $S + 1, $line);
  $t(12, 60, 440, $muted, $MB, 'ЧАЩЕ ВСЕГО ИГРАЮ');
  $names = cardHeroNames(); $x = 60; $cw = 348;
  foreach ($c['top'] as $h) {
    $n = $names[$h['heroId']] ?? ['name' => 'Герой #' . $h['heroId'], 'raw' => ''];
    $box($x, 456, $x + $cw, 548, 14, $panel);
    $img = $n['raw'] !== '' ? webroot() . '/assets/heroes/' . $n['raw'] . '.png' : '';
    if ($img !== '' && is_file($img) && ($src = @imagecreatefrompng($img))) {
      imagecopyresampled($im, $src, ($x + 14) * $S, 470 * $S, 0, 0, 114 * $S, 64 * $S, imagesx($src), imagesy($src));
      imagedestroy($src);
    }
    $name = $n['name']; $fs = 19; $max = $cw - 160;
    while ($fs > 13 && $w($fs, $MB, $name) > $max) $fs--;
    while ($w($fs, $MB, $name) > $max && mb_strlen($name) > 3) $name = mb_substr($name, 0, -2) . '…';
    $t($fs, $x + 142, 496, $white, $MB, $name);
    $t(13, $x + 142, 520, $muted, $MM, $h['games'] . ' ' . cardPlural($h['games'], 'игра', 'игры', 'игр') . ' · ' . cardFmtPct($h['wr']));
    $box($x + 142, 530, $x + $cw - 18, 534, 2, $track);
    $box($x + 142, 530, $x + 142 + ($cw - 160) * $h['wr'] / 100, 534, 2, $gold);
    $x += $cw + 18;
  }
  $t(16, 60, 596, $gold, $MB, 'dotamate.ru/me');
  $t(12, 1140, 596, $dim, $MM, 'Данные Steam Web API · сайт не связан с Valve', 'r');
  $out = imagecreatetruecolor(1200, 630);
  imagecopyresampled($out, $im, 0, 0, 0, 0, 1200, 630, $W, $H);
  imagedestroy($im);
  return $out;
}

function handleCardImage(string $tok): void {
  $c = cardLoad($tok);
  if (!$c) send(['error' => 'not_found'], 404);
  $f = cardPng($tok, $c);
  header('Content-Type: image/png');
  header('Cache-Control: public, max-age=86400');
  header('Content-Length: ' . filesize($f));
  readfile($f);
  exit;
}

// Страница карточки для ссылки в соцсетях: Open Graph + картинка + ссылка на /me/.
function handleCardPage(string $tok): void {
  $c = cardLoad($tok);
  $h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
  header('Content-Type: text/html; charset=utf-8');
  header('Cache-Control: public, max-age=3600');
  if (!$c) { http_response_code(404); echo '<!doctype html><meta charset="utf-8"><title>Карточка не найдена — Dota Mate</title><p>Карточка не найдена или устарела. <a href="/me/">Мой профиль →</a></p>'; exit; }
  $a = $c['all'];
  $title = 'Мой винрейт в Dota 2' . (!empty($c['modeLabel']) ? ' (' . $c['modeLabel'] . ')' : '') . ': ' . cardFmtPct($a['wr']) . ' за ' . $a['games'] . ' ' . cardPlural($a['games'], 'матч', 'матча', 'матчей');
  $desc = 'K/D/A ' . cardFmt1($a['k']) . '/' . cardFmt1($a['d']) . '/' . cardFmt1($a['a']) . ', GPM ' . $a['gpm'] . ', XPM ' . $a['xpm'] . '. Проверьте свои матчи на Dota Mate.';
  $page = "https://dotamate.ru/me/card/$tok/"; $img = "https://dotamate.ru/api/dota/card/$tok.png";
  echo '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    . '<title>' . $h($title) . ' — Dota Mate</title><meta name="robots" content="noindex">'
    . '<meta name="description" content="' . $h($desc) . '">'
    . '<meta property="og:type" content="website"><meta property="og:site_name" content="Dota Mate">'
    . '<meta property="og:title" content="' . $h($title) . '"><meta property="og:description" content="' . $h($desc) . '">'
    . '<meta property="og:url" content="' . $h($page) . '"><meta property="og:image" content="' . $h($img) . '">'
    . '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
    . '<meta name="twitter:card" content="summary_large_image"><link rel="icon" href="/favicon-32.png">'
    . '<style>body{margin:0;background:#101216;color:#eceef2;font:16px/1.5 system-ui,sans-serif}main{max-width:1200px;margin:0 auto;padding:24px 16px}'
    . 'img{width:100%;height:auto;border-radius:12px;display:block}a{color:#e0b25c}.b{display:inline-block;margin-top:18px;padding:12px 20px;background:#e0b25c;color:#14110a;border-radius:10px;text-decoration:none;font-weight:700}</style>'
    . '</head><body><main><img src="' . $h($img) . '" alt="' . $h($title) . '" width="1200" height="630">'
    . '<a class="b" href="/me/">Посмотреть свой профиль →</a></main></body></html>';
  exit;
}

// --- Маршруты ---
try {
  $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
  if ($path === '/api/feedback') handleFeedback();
  // Номер версии сайта (tools/deploy-hostiman.js) — без кеша хостинга, в отличие от статического /version.json.
  if ($path === '/api/version') {
    $v = json_decode((string)@file_get_contents(dataDir() . '/site-version.json'), true);
    send($v ?: ['error' => 'no_version'], $v ? 200 : 503);
  }
  if ($path === '/api/streams') { require __DIR__ . '/streams.php'; handleStreams(); }
  if (strpos($path, '/api/live/') === 0) handleLive($path);
  if (preg_match('#^/me/card/([a-f0-9]{20})/?$#', $path, $m)) handleCardPage($m[1]);
  // Раздел /pro/ — результаты про-матчей (deploy/api/pro.php, данные tools/pro/sync.js).
  if ($path === '/pro' || strpos($path, '/pro/') === 0) { require __DIR__ . '/pro.php'; handlePro($path); }
  if (strpos($path, '/api/dota/') !== 0) send(['error' => 'not_found'], 404);
  if (preg_match('#^/api/dota/player/([^/]*)/card$#', $path, $m)) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') send(['error' => 'method_not_allowed'], 405);
    handleCardCreate($m[1]);
  }
  if ($_SERVER['REQUEST_METHOD'] !== 'GET') send(['error' => 'method_not_allowed'], 405);
  if (preg_match('#^/api/dota/player/([^/]*)/card\.png$#', $path, $m)) handleCardPreview($m[1]);
  if (preg_match('#^/api/dota/card/([a-f0-9]{20})\.png$#', $path, $m)) handleCardImage($m[1]);

  if (preg_match('#^/api/dota/player/([^/]*)/matches$#', $path, $m)) handlePlayerMatches($m[1]);
  if (preg_match('#^/api/dota/match/(\d{1,19})$#', $path, $m)) handleMatchDetail($m[1]);
  if (strpos($path, '/api/dota/player/') === 0) send(['error' => 'bad_id'], 400);
  if (preg_match('#^/api/dota/hero/(\d+)/items$#', $path, $m)) {
    try { send(cached('hero-items-' . $m[1], 43200, fn() => getJson(OPENDOTA . '/heroes/' . $m[1] . '/itemPopularity'))); }
    catch (Throwable $e) { error_log('dotamate api hero_items_unavailable: ' . stripSecrets($e->getMessage())); send(['error' => 'hero_items_unavailable'], 502); }
  }
  if (preg_match('#^/api/dota/hero/([a-zA-Z0-9_]+)/abilities$#', $path, $m)) {
    try { send(heroAbilities($m[1])); }
    catch (Throwable $e) { error_log('dotamate api hero_abilities_unavailable: ' . stripSecrets($e->getMessage())); send(['error' => 'hero_abilities_unavailable'], 502); }
  }
  if ($path === '/api/dota/hero-positions') {
    // Живой Stratz с воркера давал 403 (токен привязан к IP), фактически всегда отдавался снимок.
    try { send(staticJson('/data/hero-positions.json')); }
    catch (Throwable $e) { error_log('dotamate api hero_positions_unavailable: ' . stripSecrets($e->getMessage())); send(['error' => 'hero_positions_unavailable'], 502); }
  }
  if (preg_match('#^/api/dota/hero/(\d+)/build$#', $path, $m)) {
    try { send(staticJson('/data/builds/' . $m[1] . '.json')); }
    catch (Throwable $e) { error_log('dotamate api hero_build_unavailable: ' . stripSecrets($e->getMessage())); send(['error' => 'hero_build_unavailable'], 404); }
  }
  if ($path === '/api/dota/hero-stats') {
    try { send(heroStats()); }
    catch (Throwable $e) { error_log('dotamate api hero_stats_unavailable: ' . stripSecrets($e->getMessage())); send(['error' => 'hero_stats_unavailable'], 502); }
  }
  send(['error' => 'not_found'], 404);
} catch (Throwable $e) {
  error_log('dotamate api: ' . stripSecrets($e->getMessage()));
  send(['error' => 'internal_error'], 500);
}
