<?php
// php tools/test-steam-seq.php -- production functions, no bootstrap, network or secrets.
$source = file_get_contents(__DIR__ . '/../deploy/api/index.php');
foreach (['steamSeqEstimate', 'steamFindMatch'] as $name) {
  if (!preg_match('/function ' . $name . '\(.*?\n\}/s', $source, $m)) throw new RuntimeException($name);
  eval($m[0]);
}
class SteamCtx {}
class SteamError extends RuntimeException { public string $kind = 'fixture'; }
function steamDir(): string { return __DIR__ . '/__offline_no_cache__'; }
function readJsonFile($f) { return ['v' => 2, 'anchors' => $GLOBALS['anchors']]; }
function findKnownEndTime(int $id): ?int { return $GLOBALS['known'][$id] ?? null; }
function meStoreMatch($id, $m): void {}
function steamCall($c, $method, $params): array {
  $GLOBALS['calls']++;
  if ($GLOBALS['calls'] > 8) throw new RuntimeException('Call cap exceeded');
  if ($method === 'GetMatchHistory') return ['matches' => array_slice($GLOBALS['stream'], -100)];
  if ($method !== 'GetMatchHistoryBySequenceNum') throw new RuntimeException('Unexpected API');
  $start = $params['start_at_match_seq_num'];
  if (isset($GLOBALS['starts'][$start])) throw new RuntimeException('Repeated start');
  $GLOBALS['starts'][$start] = true;
  return ['matches' => array_slice($GLOBALS['stream'], max(0, $start - 1), 100)];
}
mt_srand(132);
$stream = []; $start = 1700000000;
for ($id = 1; $id <= 200000; $id++) {
  $start += mt_rand(1, 3);
  $stream[] = ['match_id' => $id, 'start_time' => $start,
    'duration' => mt_rand(15 * 60, 90 * 60), 'players' => [], 'radiant_win' => true];
}
usort($stream, fn($a, $b) => ($a['start_time'] + $a['duration']) <=> ($b['start_time'] + $b['duration']) ?: $a['match_id'] <=> $b['match_id']);
foreach ($stream as $i => &$m) $m['match_seq_num'] = $i + 1;
unset($m);
$failures = 0; $maxCalls = 0;
for ($i = 0; $i < 200; $i++) {
  $targetIndex = mt_rand(30000, 190000); $target = $stream[$targetIndex];
  // Only windows strictly earlier than the target: exercise extrapolation, not oracle anchors.
  $anchors = [];
  foreach ([1000, 10000, 20000] as $offset) {
    foreach (array_slice($stream, $offset, 100) as $m)
      $anchors[$m['match_seq_num']] = $m['start_time'] + $m['duration'];
  }
  $known = [$target['match_id'] => $target['start_time'] + $target['duration']];
  $calls = 0; $starts = [];
  $found = steamFindMatch(new SteamCtx(), $target['match_id']);
  if (!$found || $found['match_id'] !== $target['match_id']) $failures++;
  $maxCalls = max($maxCalls, $calls);
}
$known = []; $calls = 0; $starts = [];
if (steamFindMatch(new SteamCtx(), 999999) !== null || $calls !== 0)
  throw new RuntimeException('Unknown end time must use zero Steam calls');
echo 'End-time targets: ' . (200 - $failures) . '/200; max calls: ' . $maxCalls . PHP_EOL;
exit($failures > 5 || $maxCalls > 8 ? 1 : 0);
