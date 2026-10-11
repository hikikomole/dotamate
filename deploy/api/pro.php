<?php
// Раздел /pro/: результаты профессиональных матчей, драфты, ключевые моменты, страницы турниров.
// Данные — только файлы ~/dotamate-data/pro (tools/pro/sync.js, cron на сервере): в момент запроса
// посетителя сеть не нужна. Оформление — шаблон /pro/index.html (build-pages.js, секция pro):
// в нём подменяются title/description/canonical/хлебные крошки и содержимое между <!--PRO--> и <!--/PRO-->.
// Подключается из index.php; напрямую не исполняется.
declare(strict_types=1);
if (!defined('DOTAMATE_API')) { http_response_code(404); exit; }

const PRO_STALE = 21600;             // с: данные старше 6 ч — пометка «Данные на …» (сбор не идёт во время ежедневного обновления, а оно длится до 2–3 ч)
const PRO_LIST_MAX = 60;             // матчей на /pro/
const PRO_LEAGUES_DAYS = 30;         // турниры на /pro/ — с матчами за последние N дней
const PRO_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function proDir(): string { return dataDir() . '/pro'; }
function proJson(string $name) { static $memo = []; return $memo[$name] ??= json_decode((string)@file_get_contents(proDir() . '/' . $name), true); }
function proH($s): string { return htmlspecialchars((string)$s, ENT_QUOTES | ENT_HTML5, 'UTF-8'); }
function proMsk(int $ts): DateTime { $d = new DateTime('@' . $ts); $d->setTimezone(new DateTimeZone('Europe/Moscow')); return $d; }
function proDate(int $ts, bool $time = true): string {
  $d = proMsk($ts);
  return (int)$d->format('j') . ' ' . PRO_MONTHS[(int)$d->format('n') - 1] . ' ' . $d->format('Y') . ($time ? ', ' . $d->format('H:i') . ' МСК' : '');
}
function proClock(int $s): string {
  $neg = $s < 0; $s = abs($s);
  $t = $s >= 3600 ? sprintf('%d:%02d:%02d', intdiv($s, 3600), intdiv($s % 3600, 60), $s % 60) : sprintf('%d:%02d', intdiv($s, 60), $s % 60);
  return ($neg ? '−' : '') . $t;
}
function proTeam(array $t, string $fallback): string { return trim((string)($t[1] ?? '')) !== '' ? (string)$t[1] : $fallback; }
function proSeriesLabel(?int $st): string { return [0 => 'Bo1', 1 => 'Bo3', 2 => 'Bo5', 3 => 'Bo2'][$st ?? -1] ?? ''; }
function proTier(string $t): string { return ['premium' => 'Премиум', 'professional' => 'Профессиональный', 'amateur' => 'Любительский'][$t] ?? ''; }

function proHero(int $id): array { $r = proJson('ref.json')['heroes'][$id] ?? null; return $r ? ['slug' => $r[0], 'name' => $r[1], 'page' => ($r[2] & 1) === 1, 'guide' => ($r[2] & 2) === 2] : ['slug' => '', 'name' => 'Герой #' . $id, 'page' => false, 'guide' => false]; }
function proHeroImg(int $id, string $cls = 'pr-hi'): string {
  $h = proHero($id);
  $img = $h['slug'] !== '' ? '<img src="/assets/heroes/' . proH($h['slug']) . '.webp" alt="' . proH($h['name']) . '" width="64" height="36" loading="lazy">' : '<span class="pr-noimg"></span>';
  return $h['page'] ? '<a class="' . $cls . '" href="/hero/' . proH($h['slug']) . '/" title="' . proH($h['name']) . '">' . $img . '</a>' : '<span class="' . $cls . '" title="' . proH($h['name']) . '">' . $img . '</span>';
}
function proItemImg(int $id): string {
  $r = proJson('ref.json')['items'][$id] ?? null;
  if (!$r) return '';
  $img = '<img src="/assets/items/' . proH($r[0]) . '.png" alt="' . proH($r[1]) . '" title="' . proH($r[1]) . '" width="33" height="24" loading="lazy">';
  return $r[2] ? '<a href="/item/' . proH($r[0]) . '/">' . $img . '</a>' : $img;
}

function proIndex(): array { $i = proJson('index.json'); return is_array($i['matches'] ?? null) ? $i['matches'] : []; }
function proStamp(): string {
  $s = proJson('status.json') ?: [];
  $ok = (int)($s['lastOk'] ?? 0);
  if (!$ok) return '';
  if (time() - $ok > PRO_STALE) return '<p class="pr-stale" role="status">Данные на ' . proDate($ok) . '.</p>';
  return '<p class="pr-stamp">Обновлено ' . proDate($ok) . '. Данные: <a href="https://www.opendota.com/" rel="noopener" target="_blank">OpenDota</a>.</p>';
}

// --- вывод через шаблон страницы ---
function proPage(int $status, string $title, string $desc, string $canonical, array $crumbs, string $body, bool $noindex = false): void {
  $tpl = (string)@file_get_contents(webroot() . '/pro/index.html');
  if ($tpl === '' || strpos($tpl, '<!--PRO-->') === false) { error_log('dotamate pro: нет шаблона /pro/index.html'); send(['error' => 'pro_template_missing'], 500); }
  $old = fn(string $re) => preg_match($re, $tpl, $m) ? $m[1] : null;
  $oT = $old('#<title>(.*?)</title>#s'); $oD = $old('#<meta name="description" content="([^"]*)">#'); $oC = $old('#<link rel="canonical" href="([^"]*)">#');
  $rep = [];
  if ($oT !== null) $rep[$oT] = proH($title);
  if ($oD !== null) $rep[$oD] = proH($desc);
  if ($oC !== null) $rep['"' . $oC . '"'] = '"' . proH($canonical) . '"';
  $html = strtr($tpl, $rep);
  // Хлебные крошки: разметка и BreadcrumbList заменяются целиком.
  $ld = ['@context' => 'https://schema.org', '@type' => 'BreadcrumbList', 'itemListElement' => []];
  $vis = [];
  foreach (array_merge([['Главная', 'https://dotamate.ru/']], $crumbs) as $k => [$name, $url]) {
    $ld['itemListElement'][] = ['@type' => 'ListItem', 'position' => $k + 1, 'name' => $name, 'item' => $url];
    $vis[] = $k === count($crumbs) ? '<span aria-current="page">' . proH($name) . '</span>' : '<a href="' . proH(str_replace('https://dotamate.ru', '', $url)) . '">' . proH($name) . '</a>';
  }
  $bc = '<script type="application/ld+json">' . json_encode($ld, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG) . "</script>\n"
    . '<div class="container breadcrumbs">' . implode(' <span>›</span> ', $vis) . '</div>';
  $html = (string)preg_replace_callback('#<script type="application/ld\+json">\{"@context":"https://schema\.org","@type":"BreadcrumbList".*?<div class="container breadcrumbs">.*?</div>#s', fn() => $bc, $html, 1);
  if ($noindex) $html = str_replace('<meta name="description"', '<meta name="robots" content="noindex">' . "\n" . '<meta name="description"', $html);
  $html = (string)preg_replace_callback('#<!--PRO-->.*?<!--/PRO-->#s', fn() => $body, $html, 1);
  http_response_code($status);
  header('Content-Type: text/html; charset=utf-8');
  header('Cache-Control: no-cache');
  if ($status === 503) header('Retry-After: 1800');
  echo $html;
  exit;
}
function proNotFound(string $what): void {
  proPage(404, 'Не найдено — Про-матчи | Dota Mate', 'Страница не найдена.', 'https://dotamate.ru/pro/', [['Про-матчи', 'https://dotamate.ru/pro/'], ['Не найдено', 'https://dotamate.ru/pro/']],
    '<h1 class="page-title">Не найдено</h1><p class="pr-lead">' . proH($what) . ' Возможно, матч ещё не загружен или старше 120 дней.</p><p><a class="pr-btn" href="/pro/">Все про-матчи →</a></p>', true);
}

// --- строки списка матчей ---
function proRow(array $m): string {
  $rw = $m['rw'] ?? null; $r = proTeam($m['r'] ?? [], 'Radiant'); $d = proTeam($m['d'] ?? [], 'Dire');
  $draft = function (array $ids): string { $o = ''; foreach (array_slice($ids, 0, 5) as $id) $o .= proHeroImg((int)$id, 'pr-mini'); return $o; };
  return '<a class="pr-row" href="/pro/match/' . (int)$m['id'] . '/">'
    . '<span class="pr-time">' . proMsk((int)$m['start'])->format('H:i') . '</span>'
    . '<span class="pr-teams"><span class="pr-t' . ($rw === 1 ? ' win' : '') . '">' . proH($r) . '</span>'
    . '<span class="pr-score">' . (int)($m['rs'] ?? 0) . ' : ' . (int)($m['ds'] ?? 0) . '</span>'
    . '<span class="pr-t' . ($rw === 0 ? ' win' : '') . '">' . proH($d) . '</span></span>'
    . '<span class="pr-drafts"><span>' . str_replace(['<a ', '</a>'], ['<span ', '</span>'], $draft($m['rp'] ?? [])) . '</span><i>vs</i><span>' . str_replace(['<a ', '</a>'], ['<span ', '</span>'], $draft($m['dp'] ?? [])) . '</span></span>'
    . '<span class="pr-meta">' . proH($m['ln'] ?? '') . ' · ' . proClock((int)($m['dur'] ?? 0)) . '</span></a>';
}
function proRowsByDay(array $list): string {
  $out = ''; $day = null;
  foreach ($list as $m) {
    $d = proDate((int)$m['start'], false);
    if ($d !== $day) { if ($day !== null) $out .= '</div>'; $out .= '<h3 class="pr-day">' . proH($d) . '</h3><div class="pr-rows">'; $day = $d; }
    $out .= proRow($m);
  }
  return $out . ($day !== null ? '</div>' : '');
}
function proLeagues(array $list): array {
  $lg = [];
  foreach ($list as $m) {
    $id = (int)($m['lg'] ?? 0); if (!$id) continue;
    $l = &$lg[$id];
    $l ??= ['id' => $id, 'name' => $m['ln'] ?? '', 'tier' => '', 'first' => PHP_INT_MAX, 'last' => 0, 'n' => 0];
    $l['first'] = min($l['first'], (int)$m['start']); $l['last'] = max($l['last'], (int)$m['start']); $l['n']++;
    if (!empty($m['tier'])) $l['tier'] = $m['tier'];
    unset($l);
  }
  usort($lg, fn($a, $b) => $b['last'] <=> $a['last']);
  return $lg;
}
function proRange(int $a, int $b): string { $x = proDate($a, false); $y = proDate($b, false); return $x === $y ? $x : $x . ' — ' . $y; }

// --- /pro/ ---
function proHome(): void {
  $all = array_values(array_filter(proIndex(), fn($m) => !empty($m['has'])));
  if (!$all) proPage(503, 'Про-матчи Dota 2 — результаты и драфты | Dota Mate', 'Результаты профессиональных матчей Dota 2.', 'https://dotamate.ru/pro/', [['Про-матчи', 'https://dotamate.ru/pro/']],
    '<h1 class="page-title">Про-матчи Dota 2</h1><p class="pr-lead">Результаты ещё загружаются. Загляните через полчаса.</p>', true);
  $since = time() - PRO_LEAGUES_DAYS * 86400;
  $lgs = array_slice(array_values(array_filter(proLeagues($all), fn($l) => $l['last'] >= $since)), 0, 16);
  $lgHtml = '';
  foreach ($lgs as $l) $lgHtml .= '<a class="pr-lg" href="/pro/league/' . $l['id'] . '/"><b>' . proH($l['name']) . '</b><span>' . proH(proRange($l['first'], $l['last'])) . ' · ' . $l['n'] . ' ' . proPlural($l['n'], 'игра', 'игры', 'игр') . ($l['tier'] && proTier($l['tier']) ? ' · ' . proTier($l['tier']) : '') . '</span></a>';
  $body = '<h1 class="page-title">Про-матчи Dota 2</h1>'
    . '<div class="pr-intro"><p>Счёт, драфт, статистика игроков и ключевые моменты про-матчей. Повторы на карте — в <a href="/live/">эфире</a>.</p>' . proStamp() . '</div>'
    . ($lgHtml ? '<h2 class="pr-h2">Турниры за последние ' . PRO_LEAGUES_DAYS . ' дней</h2><div class="pr-lgs">' . $lgHtml . '</div>' : '')
    . '<h2 class="pr-h2">Последние матчи</h2>' . proRowsByDay(array_slice($all, 0, PRO_LIST_MAX))
    . '<p class="pr-note">Здесь только сыгранные матчи. Расписания будущих игр в открытых источниках без договора нет, поэтому календаря пока нет.</p>';
  $n = count($all);
  proPage(200, 'Про-матчи Dota 2 — результаты, драфты и турниры | Dota Mate',
    'Результаты профессиональных матчей Dota 2: счёт, пики и баны, статистика игроков и ключевые моменты. ' . $n . ' ' . proPlural($n, 'матч', 'матча', 'матчей') . ' турниров последних месяцев, обновление каждые полчаса.',
    'https://dotamate.ru/pro/', [['Про-матчи', 'https://dotamate.ru/pro/']], $body);
}
function proPlural(int $n, string $a, string $b, string $c): string { $n = abs($n) % 100; $m = $n % 10; return $n > 10 && $n < 20 ? $c : ($m === 1 ? $a : ($m >= 2 && $m <= 4 ? $b : $c)); }

// --- /pro/league/<id>/ ---
function proLeague(int $id): void {
  $list = array_values(array_filter(proIndex(), fn($m) => (int)($m['lg'] ?? 0) === $id && !empty($m['has'])));
  if (!$list) proNotFound('Турнира с таким номером в наших данных нет.');
  $l = proLeagues($list)[0];
  $teams = []; $picks = [];
  foreach ($list as $m) {
    foreach ([['r', 1], ['d', 0]] as [$side, $winVal]) {
      $t = $m[$side] ?? []; $key = (int)($t[0] ?? 0) ?: proTeam($t, '');
      if ($key === '' || $key === 0) continue;
      $x = &$teams[$key]; $x ??= ['name' => proTeam($t, ''), 'w' => 0, 'l' => 0];
      if (($m['rw'] ?? null) === $winVal) $x['w']++; elseif (isset($m['rw'])) $x['l']++;
      unset($x);
    }
    foreach (array_merge($m['rp'] ?? [], $m['dp'] ?? []) as $h) $picks[(int)$h] = ($picks[(int)$h] ?? 0) + 1;
  }
  uasort($teams, fn($a, $b) => [$b['w'], -$b['l']] <=> [$a['w'], -$a['l']]);
  arsort($picks);
  $tRows = ''; foreach ($teams as $t) $tRows .= '<tr><td>' . proH($t['name']) . '</td><td>' . ($t['w'] + $t['l']) . '</td><td>' . $t['w'] . '</td><td>' . $t['l'] . '</td></tr>';
  $pHtml = ''; foreach (array_slice($picks, 0, 12, true) as $h => $c) { $hh = proHero($h); $pHtml .= '<div class="pr-pick">' . proHeroImg($h) . '<span>' . proH($hh['name']) . '<b>' . $c . '</b></span></div>'; }
  $n = count($list);
  $body = '<h1 class="page-title pr-title-sm">' . proH($l['name']) . '</h1>'
    . '<p class="pr-lead">' . proH(proRange($l['first'], $l['last'])) . ' · ' . $n . ' ' . proPlural($n, 'игра', 'игры', 'игр') . ' в наших данных' . ($l['tier'] && proTier($l['tier']) ? ' · уровень турнира: ' . proTier($l['tier']) : '') . '.</p>'
    . proStamp()
    . '<div class="pr-cols"><div><h2 class="pr-h2">Команды</h2><div class="pr-tablewrap"><table class="pr-table"><thead><tr><th>Команда</th><th>Игр</th><th>Побед</th><th>Поражений</th></tr></thead><tbody>' . $tRows . '</tbody></table></div>'
    . '<p class="pr-note">Считаются отдельные игры (не серии) из тех, что попали в наши данные.</p></div>'
    . '<div><h2 class="pr-h2">Чаще всего брали</h2><div class="pr-picks">' . $pHtml . '</div></div></div>'
    . '<h2 class="pr-h2">Матчи</h2>' . proRowsByDay($list);
  $url = 'https://dotamate.ru/pro/league/' . $id . '/';
  proPage(200, $l['name'] . ' — результаты матчей и драфты | Dota Mate',
    $l['name'] . ': результаты ' . $n . ' ' . proPlural($n, 'игры', 'игр', 'игр') . ' (' . proRange($l['first'], $l['last']) . '), команды, победы и поражения, самые популярные герои, драфт каждого матча.',
    $url, [['Про-матчи', 'https://dotamate.ru/pro/'], [$l['name'], $url]], $body);
}

// --- /pro/match/<id>/ ---
function proNum(int $n): string { return number_format($n, 0, ',', ' '); }
function proK(int $n): string { return $n >= 10000 ? str_replace('.', ',', (string)round($n / 1000, 1)) . 'k' : proNum($n); }
// Линия графика: точки по минутам, общий масштаб для золота и опыта.
function proLine(array $v, int $W, int $H, int $max, int $n): string {
  $pts = []; foreach ($v as $k => $x) $pts[] = round($k * $W / max(1, $n), 1) . ',' . round($H / 2 - $x * ($H / 2 - 6) / $max, 1);
  return implode(' ', $pts);
}
function proMatch(string $id): void {
  if (!preg_match('/^\d{6,12}$/', $id)) proNotFound('Неверный номер матча.');
  $m = json_decode((string)@file_get_contents(proDir() . '/matches/' . $id . '.json'), true);
  if (!$m) proNotFound('Матч ' . $id . ' в наших данных не найден.');
  $r = $m['radiant']['name'] ?: 'Radiant'; $d = $m['dire']['name'] ?: 'Dire';
  $win = $m['rw'] ? $r : $d; $lgName = $m['league']['name'] ?: 'Турнир';
  $bySlot = []; foreach ($m['players'] as $p) $bySlot[(int)$p['slot']] = $p;
  $sideName = fn(int $s) => $s === 0 ? $r : $d;
  $has = fn(string $k) => (bool)array_filter($m['players'], fn($p) => isset($p[$k]) && $p[$k] !== null);   // поле есть хотя бы у одного игрока (формат v2, разобранный реплей)
  $sum = function (string $k, int $s) use ($m): int { $t = 0; foreach ($m['players'] as $p) if ((int)$p['s'] === $s) $t += (int)($p[$k] ?? 0); return $t; };

  // серия
  $series = ''; $serLbl = proSeriesLabel($m['st'] ?? null);
  if (!empty($m['ser'])) {
    $games = array_values(array_filter(proIndex(), fn($x) => (int)($x['ser'] ?? 0) === (int)$m['ser']));
    usort($games, fn($a, $b) => $a['start'] <=> $b['start']);
    if (count($games) > 1) {
      $li = '';
      foreach ($games as $k => $g) {
        $lbl = '<span>Игра ' . ($k + 1) . '</span> ' . proH(proTeam($g['r'] ?? [], 'Radiant')) . ' <b>' . (int)$g['rs'] . ':' . (int)$g['ds'] . '</b> ' . proH(proTeam($g['d'] ?? [], 'Dire'));
        $li .= (string)$g['id'] === $id ? '<li aria-current="true">' . $lbl . '</li>' : ($g['has'] ? '<li><a href="/pro/match/' . (int)$g['id'] . '/">' . $lbl . '</a></li>' : '<li>' . $lbl . '</li>');
      }
      $series = '<section class="pr-card"><h2 class="pr-h2">Серия ' . proH($serLbl) . '</h2><ol class="pr-series">' . $li . '</ol></section>';
    }
  }
  // драфт
  $picks = [[], []]; $bans = [[], []]; $order = '';
  foreach ($m['pb'] as [$h, $isPick, $team, $ord]) {
    $team = (int)$team === 1 ? 1 : 0;
    if ($isPick) $picks[$team][] = (int)$h; else $bans[$team][] = (int)$h;
    $order .= '<li class="' . ($team ? 'dire' : 'rad') . ($isPick ? ' pick' : ' ban') . '"><span class="pr-ord">' . ((int)$ord + 1) . '</span>' . proHeroImg((int)$h, 'pr-mini') . '<span class="pr-pb">' . ($isPick ? 'Пик' : 'Бан') . '</span></li>';
  }
  if (!$picks[0] && !$picks[1]) foreach ($m['players'] as $p) $picks[(int)$p['s']][] = (int)$p['h'];
  $teamDraft = function (int $s) use ($picks, $bans, $sideName): string {
    $o = '<div class="pr-dteam ' . ($s ? 'dire' : 'rad') . '"><h3>' . proH($sideName($s)) . ' <small>' . ($s ? 'Тьма' : 'Свет') . '</small></h3><div class="pr-dpicks">';
    foreach ($picks[$s] as $h) { $hh = proHero($h); $o .= '<div class="pr-dp">' . proHeroImg($h) . '<span>' . proH($hh['name']) . '</span>' . ($hh['guide'] ? '<a class="pr-guide" href="/hero/' . proH($hh['slug']) . '/guide/">гайд</a>' : '') . '</div>'; }
    $o .= '</div>';
    if ($bans[$s]) { $o .= '<div class="pr-dbans"><span>Баны:</span>'; foreach ($bans[$s] as $h) $o .= proHeroImg($h, 'pr-mini ban'); $o .= '</div>'; }
    return $o . '</div>';
  };
  $dmHash = implode('-', $picks[0]) . '_' . implode('-', $picks[1]) . '_' . implode('-', array_merge($bans[0], $bans[1]));
  $replay = is_file(liveMatchFile((string)(int)$m['id']));   // матч есть в архиве эфира — можно смотреть повтор на карте
  $btns = '<div class="pr-btns">' . ($replay ? '<a class="pr-btn pr-btn-main" href="/live/?m=' . (int)$m['id'] . '">Смотреть повтор на карте →</a>' : '')
    . (count($picks[0]) === 5 && count($picks[1]) === 5 ? '<a class="pr-btn" href="/#draft=' . proH($dmHash) . '">Открыть драфт в DraftMate →</a>' : '') . '</div>';
  $draft = '<section class="pr-card"><h2 class="pr-h2">Драфт</h2><div class="pr-draft">' . $teamDraft(0) . $teamDraft(1) . '</div>'
    . ($order ? '<details class="pr-order"><summary>Порядок пиков и банов</summary><ol>' . $order . '</ol></details>' : '') . '</section>';

  // ключевые моменты и счётчики строений
  $lane = ['top' => 'на верхней линии', 'mid' => 'на центре', 'bot' => 'на нижней линии'];
  $ev = []; $towers = [0, 0]; $rax = [0, 0]; $rosh = [0, 0]; $fb = null;
  foreach ($m['obj'] as $o) {
    [$t, $type, $side] = [$o[0], $o[1], (int)$o[2]];
    if ($type === 'fb') { $fb = [(int)$t, $side]; $p = $bySlot[(int)($o[3] ?? -1)] ?? null; $ev[] = [$t, 'Первая кровь — ' . proH($sideName($side)) . ($p ? ' (' . proH(proHero((int)$p['h'])['name']) . ')' : ''), 'fb']; }
    elseif ($type === 'rosh') { $rosh[$side]++; $ev[] = [$t, 'Рошан убит — ' . proH($sideName($side)), 'rosh']; }
    elseif ($type === 'tower' && preg_match('/^tower([1-4])(?:_(top|mid|bot))?$/', (string)$o[3], $x)) { $towers[1 - $side]++; $ev[] = [$t, proH($sideName($side)) . ' теряет башню ' . $x[1] . '-го уровня' . (isset($x[2]) ? ' ' . $lane[$x[2]] : ''), 'tower']; }
    elseif ($type === 'rax' && preg_match('/^melee(?:_(top|mid|bot))?$/', (string)$o[3], $x)) { $rax[1 - $side]++; $ev[] = [$t, proH($sideName($side)) . ' теряет казармы' . (isset($x[1]) ? ' ' . $lane[$x[1]] : ''), 'rax']; }
    elseif ($type === 'fort') $ev[] = [$t, 'Трон ' . proH($sideName($side)) . ' разрушен', 'fort'];
  }
  foreach ($m['tf'] as [$a, $b, $n]) $ev[] = [(int)$a, 'Драка: ' . (int)$n . ' ' . proPlural((int)$n, 'смерть', 'смерти', 'смертей') . ' за ' . proClock((int)$b - (int)$a), 'tf'];
  usort($ev, fn($a, $b) => $a[0] <=> $b[0]);
  $evHtml = ''; foreach ($ev as [$t, $txt, $cls]) $evHtml .= '<li class="' . $cls . '"><time>' . proClock((int)$t) . '</time><span>' . $txt . '</span></li>';
  $moments = '<section class="pr-card"><h2 class="pr-h2">Ключевые моменты</h2>' . ($evHtml ? '<ol class="pr-moments">' . $evHtml . '</ol><p class="pr-note">Время — от начала игры (горна), по разобранному реплею.</p>'
    : '<p class="pr-note">Реплей этого матча ещё не разобран — моменты появятся позже.</p>') . '</section>';

  // сравнение команд: строка «Свет — показатель — Тьма» с полосой долей
  $parsed = !empty($m['obj']);
  $cmpRows = [['Убийства', (int)$m['rs'], (int)$m['ds'], true], ['Капитал', $sum('nw', 0), $sum('nw', 1), true], ['Добито крипов', $sum('lh', 0), $sum('lh', 1), true]];
  if ($has('hd')) $cmpRows[] = ['Урон героям', $sum('hd', 0), $sum('hd', 1), true];
  if ($has('td')) $cmpRows[] = ['Урон по строениям', $sum('td', 0), $sum('td', 1), true];
  if ($parsed) { $cmpRows[] = ['Башни снесено', $towers[0], $towers[1], true]; $cmpRows[] = ['Казармы снесено', $rax[0], $rax[1], true]; $cmpRows[] = ['Рошан', $rosh[0], $rosh[1], true]; }
  if ($has('obs')) $cmpRows[] = ['Варды (обзор/невид.)', $sum('obs', 0) + $sum('sen', 0), $sum('obs', 1) + $sum('sen', 1), true, $sum('obs', 0) . '/' . $sum('sen', 0), $sum('obs', 1) . '/' . $sum('sen', 1)];
  $cmp = '';
  foreach ($cmpRows as $row) {
    [$lbl, $a, $b] = $row; $tot = max(1, $a + $b); $pa = round($a * 100 / $tot, 1);
    $ta = $row[4] ?? ($a >= 10000 ? proK($a) : proNum($a)); $tb = $row[5] ?? ($b >= 10000 ? proK($b) : proNum($b));
    $cmp .= '<div class="pr-cmp-row"><b class="rad' . ($a > $b ? ' lead' : '') . '">' . proH($ta) . '</b><span class="pr-cmp-l">' . proH($lbl) . '<i class="pr-bar" aria-hidden="true"><i style="width:' . $pa . '%"></i></i></span><b class="dire' . ($b > $a ? ' lead' : '') . '">' . proH($tb) . '</b></div>';
  }
  $facts = [];
  if ($fb) $facts[] = 'Первая кровь ' . proClock($fb[0]) . ' — ' . proH($sideName($fb[1]));
  if ($serLbl) $facts[] = 'Серия ' . proH($serLbl);
  if (!empty($m['league']['tier']) && proTier((string)$m['league']['tier'])) $facts[] = proTier((string)$m['league']['tier']) . ' турнир';

  // график преимущества: золото и (если есть) опыт
  $chart = '';
  $adv = array_map('intval', $m['adv'] ?? []); $xadv = array_map('intval', $m['xadv'] ?? []);
  if (count($adv) >= 3) {
    $W = 640; $H = 170; $n = count($adv) - 1;
    $max = max(1000, max(array_map('abs', $adv)), $xadv ? max(array_map('abs', $xadv)) : 0);
    $grid = ''; foreach ([10, 20, 30, 40, 50, 60, 70, 80] as $mn) if ($mn < $n) $grid .= '<line x1="' . round($mn * $W / $n, 1) . '" y1="0" x2="' . round($mn * $W / $n, 1) . '" y2="' . $H . '" class="g"/>';
    $peakR = max($adv); $peakD = min($adv);
    $chart = '<section class="pr-card"><h2 class="pr-h2">Преимущество по ходу матча</h2><figure class="pr-chart"><svg viewBox="0 0 ' . $W . ' ' . $H . '" preserveAspectRatio="none" role="img" aria-label="Разница капитала' . ($xadv ? ' и опыта' : '') . ' команд по минутам">'
      . $grid . '<line x1="0" y1="' . ($H / 2) . '" x2="' . $W . '" y2="' . ($H / 2) . '" class="z"/>'
      . (count($xadv) >= 3 ? '<polyline class="xp" points="' . proLine($xadv, $W, $H, $max, count($xadv) - 1) . '"/>' : '')
      . '<polyline points="' . proLine($adv, $W, $H, $max, $n) . '"/></svg>'
      . '<figcaption><span class="rad">↑ ' . proH($r) . '</span><span class="pr-legend"><i class="lg-g"></i>золото' . (count($xadv) >= 3 ? ' <i class="lg-x"></i>опыт' : '') . ' · шкала ±' . proNum($max) . ' · ' . $n . ' мин</span><span class="dire">↓ ' . proH($d) . '</span></figcaption></figure>'
      . '<p class="pr-note">Наибольший перевес: ' . proH($r) . ' — ' . proNum(max(0, $peakR)) . ' золота, ' . proH($d) . ' — ' . proNum(max(0, -$peakD)) . ' золота.</p></section>';
  }

  // лучшие в матче (по полям, которые есть в данных)
  $best = '';
  foreach ([['k', 'Больше всех убийств', ''], ['nw', 'Наибольший капитал', ' золота'], ['hd', 'Урон героям', ''], ['td', 'Урон по строениям', ''], ['hh', 'Лечение', ''], ['lh', 'Добито крипов', ''], ['obs', 'Поставил вардов обзора', ''], ['stk', 'Стаков лагерей', '']] as [$k, $lbl, $suf]) {
    if (!$has($k)) continue;
    $top = null; foreach ($m['players'] as $p) if ($top === null || (int)($p[$k] ?? 0) > (int)($top[$k] ?? 0)) $top = $p;
    if (!$top || (int)($top[$k] ?? 0) <= 0) continue;
    $best .= '<div class="pr-best ' . ((int)$top['s'] ? 'dire' : 'rad') . '">' . proHeroImg((int)$top['h'], 'pr-mini') . '<span><small>' . proH($lbl) . '</small><b>' . proNum((int)$top[$k]) . $suf . '</b> ' . proH($top['n'] ?: proHero((int)$top['h'])['name']) . '</span></div>';
  }
  $best = $best ? '<section class="pr-card"><h2 class="pr-h2">Лучшие в матче</h2><div class="pr-bests">' . $best . '</div></section>' : '';

  // игроки
  $cols = ['hd' => 'Урон героям', 'td' => 'Урон строениям', 'hh' => 'Лечение'];
  $cols = array_filter($cols, fn($k) => $has($k), ARRAY_FILTER_USE_KEY);
  $wards = $has('obs');
  $ptab = function (int $s) use ($m, $sideName, $cols, $wards): string {
    $o = '<h3 class="pr-h3 ' . ($s ? 'dire' : 'rad') . '">' . proH($sideName($s)) . ((int)$m['rw'] === ($s ? 0 : 1) ? ' <em class="pr-win">Победа</em>' : '') . '</h3><div class="pr-tablewrap"><table class="pr-table pr-players"><thead><tr><th>Герой</th><th>Игрок</th><th title="Уровень">Ур.</th><th title="Убийства / смерти / помощь">У/С/П</th><th>Капитал</th><th title="Добито / не отдано">Добито</th><th title="Золото и опыт в минуту">З/мин · О/мин</th>';
    foreach ($cols as $lbl) $o .= '<th>' . $lbl . '</th>';
    if ($wards) $o .= '<th title="Варды обзора / невидимости">Варды</th>';
    $o .= '<th>Предметы</th></tr></thead><tbody>';
    foreach ($m['players'] as $p) {
      if ((int)$p['s'] !== $s) continue;
      $it = ''; foreach ($p['it'] as $i) $it .= proItemImg((int)$i);
      $extra = '';
      if (!empty($p['nt'])) $extra .= '<span class="pr-nt" title="Нейтральный предмет">' . proItemImg((int)$p['nt']) . '</span>';
      if (!empty($p['bp'])) { $extra .= '<span class="pr-bp" title="Рюкзак">'; foreach ($p['bp'] as $i) $extra .= proItemImg((int)$i); $extra .= '</span>'; }
      if (!empty($p['sc'])) $extra .= '<span class="pr-tag" title="Aghanim\'s Scepter">Аганим</span>';
      if (!empty($p['sh'])) $extra .= '<span class="pr-tag" title="Aghanim\'s Shard">Шард</span>';
      $hh = proHero((int)$p['h']);
      $o .= '<tr><td class="pr-hcell">' . proHeroImg((int)$p['h'], 'pr-mini') . '<span>' . proH($hh['name']) . '</span></td><td class="pr-pname">' . proH($p['n'] ?: '—') . '</td><td>' . (int)($p['lvl'] ?? 0) . '</td><td class="pr-kda">' . (int)$p['k'] . '/' . (int)$p['d'] . '/' . (int)$p['a'] . '</td><td>' . proNum((int)$p['nw']) . '</td><td>' . (int)$p['lh'] . '/' . (int)$p['dn'] . '</td><td>' . (int)$p['gpm'] . ' · ' . (int)$p['xpm'] . '</td>';
      foreach (array_keys($cols) as $k) $o .= '<td>' . (isset($p[$k]) ? proNum((int)$p[$k]) : '—') . '</td>';
      if ($wards) $o .= '<td>' . (isset($p['obs']) ? (int)$p['obs'] . '/' . (int)($p['sen'] ?? 0) : '—') . '</td>';
      $o .= '<td><div class="pr-items">' . $it . $extra . '</div></td></tr>';
    }
    return $o . '</tbody></table></div>';
  };
  // ключевые покупки по времени
  $buys = '';
  if ($has('kp')) {
    foreach ([0, 1] as $s) {
      $rows = '';
      foreach ($m['players'] as $p) {
        if ((int)$p['s'] !== $s || empty($p['kp'])) continue;
        $chips = ''; foreach ($p['kp'] as [$t, $iid]) { $img = proItemImg((int)$iid); if ($img !== '') $chips .= '<span class="pr-kp">' . $img . '<time>' . proClock((int)$t) . '</time></span>'; }
        if ($chips !== '') $rows .= '<div class="pr-kprow">' . proHeroImg((int)$p['h'], 'pr-mini') . '<div class="pr-kps">' . $chips . '</div></div>';
      }
      if ($rows !== '') $buys .= '<div class="pr-kpteam"><h3 class="pr-h3 ' . ($s ? 'dire' : 'rad') . '">' . proH($sideName($s)) . '</h3>' . $rows . '</div>';
    }
    if ($buys !== '') $buys = '<section class="pr-card pr-wide"><h2 class="pr-h2">Ключевые покупки</h2><div class="pr-kpgrid">' . $buys . '</div><p class="pr-note">Первая покупка собираемых предметов от 1400 золота; время — минуты от горна.</p></section>';
  }

  $logo = fn(array $t) => $t['logo'] ? '<img class="pr-logo" src="' . proH($t['logo']) . '" alt="" width="56" height="56" loading="lazy" referrerpolicy="no-referrer">' : '';
  $body = '<h1 class="page-title pr-title-sm">' . proH($r) . ' — ' . proH($d) . '</h1>'
    . '<p class="pr-lead"><a href="/pro/league/' . (int)$m['league']['id'] . '/">' . proH($lgName) . '</a> · ' . proDate((int)$m['start']) . ' · длительность ' . proClock((int)$m['dur']) . '</p>'
    . '<div class="pr-board"><div class="pr-bhead"><div class="pr-bt rad' . ($m['rw'] ? ' win' : '') . '">' . $logo($m['radiant']) . '<span><b>' . proH($r) . '</b><small>Свет</small></span>' . ($m['rw'] ? '<em>Победа</em>' : '') . '</div>'
    . '<div class="pr-bscore">' . (int)$m['rs'] . ' : ' . (int)$m['ds'] . '<small>' . proClock((int)$m['dur']) . '</small></div>'
    . '<div class="pr-bt dire' . (!$m['rw'] ? ' win' : '') . '">' . $logo($m['dire']) . '<span><b>' . proH($d) . '</b><small>Тьма</small></span>' . (!$m['rw'] ? '<em>Победа</em>' : '') . '</div></div>'
    . '<div class="pr-cmp">' . $cmp . '</div>'
    . ($facts ? '<p class="pr-facts">' . implode(' · ', $facts) . '</p>' : '') . $btns . '</div>'
    . '<div class="pr-mgrid">' . $draft . $chart . $moments . '<div class="pr-side">' . $best . $series . '</div></div>'
    . '<section class="pr-card pr-wide"><h2 class="pr-h2">Игроки</h2>' . $ptab(0) . $ptab(1) . '</section>'
    . $buys
    . '<p class="pr-src">Источник данных: <a href="https://www.opendota.com/matches/' . (int)$m['id'] . '" rel="noopener" target="_blank">OpenDota, матч ' . (int)$m['id'] . '</a>' . ($replay ? '; повтор на карте — из нашего разбора реплея' : '') . '.</p>';
  $url = 'https://dotamate.ru/pro/match/' . (int)$m['id'] . '/';
  $heroes = implode(', ', array_map(fn($h) => proHero($h)['name'], array_merge(array_slice($picks[0], 0, 2), array_slice($picks[1], 0, 2))));
  proPage(200, $r . ' vs ' . $d . ' — ' . $lgName . ', ' . proDate((int)$m['start'], false) . ' | Dota Mate',
    $r . ' — ' . $d . ' ' . (int)$m['rs'] . ':' . (int)$m['ds'] . ', победа ' . $win . '. ' . $lgName . ', ' . proDate((int)$m['start'], false) . '. Драфт (' . $heroes . '…), статистика игроков и ключевые моменты.',
    $url, [['Про-матчи', 'https://dotamate.ru/pro/'], [$lgName, 'https://dotamate.ru/pro/league/' . (int)$m['league']['id'] . '/'], [$r . ' — ' . $d, $url]], $body);
}

// --- /pro/sitemap.xml ---
function proSitemap(): void {
  $list = array_values(array_filter(proIndex(), fn($m) => !empty($m['has'])));
  $u = ['https://dotamate.ru/pro/' => $list ? (int)$list[0]['start'] : time()];
  foreach (proLeagues($list) as $l) $u['https://dotamate.ru/pro/league/' . $l['id'] . '/'] = $l['last'];
  foreach ($list as $m) $u['https://dotamate.ru/pro/match/' . (int)$m['id'] . '/'] = (int)$m['start'] + (int)$m['dur'];
  header('Content-Type: application/xml; charset=utf-8');
  header('Cache-Control: public, max-age=1800');
  echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
  foreach ($u as $loc => $ts) echo '<url><loc>' . proH($loc) . '</loc><lastmod>' . gmdate('Y-m-d', $ts) . '</lastmod></url>' . "\n";
  echo '</urlset>' . "\n";
  exit;
}

function handlePro(string $path): void {
  if (!in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true)) send(['error' => 'method_not_allowed'], 405);
  if ($path === '/pro/sitemap.xml') proSitemap();
  if (preg_match('#^/pro(/match/\d+|/league/\d+)?$#', $path)) { header('Location: https://dotamate.ru' . $path . '/', true, 301); exit; }
  if ($path === '/pro/' || $path === '/pro/index.html') proHome();
  if (preg_match('#^/pro/match/([^/]+)/$#', $path, $m)) proMatch($m[1]);
  if (preg_match('#^/pro/league/(\d{1,9})/$#', $path, $m)) proLeague((int)$m[1]);
  proNotFound('Такой страницы в разделе нет.');
}
