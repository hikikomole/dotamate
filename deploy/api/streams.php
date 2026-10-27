<?php
// Streams endpoint. Included by index.php after shared cache/data helpers.
declare(strict_types=1);
if (!defined('DOTAMATE_API')) exit;

function twitchRequest(string $url, array $headers = [], ?string $post = null): array {
  $opts = ['http' => ['timeout' => 4, 'ignore_errors' => true,
    'method' => $post === null ? 'GET' : 'POST',
    'header' => implode("\r\n", array_merge(['Accept: application/json', 'User-Agent: dotamate.ru'], $headers)) . "\r\n"]];
  if ($post !== null) $opts['http']['content'] = $post;
  $body = @file_get_contents($url, false, stream_context_create($opts));
  $status = 0;
  foreach ($http_response_header ?? [] as $line) if (preg_match('#^HTTP/\S+\s+(\d+)#', $line, $m)) $status = (int)$m[1];
  if ($body === false || $status < 200 || $status >= 300) throw new RuntimeException('twitch_http_' . $status);
  $json = json_decode($body, true);
  if (!is_array($json)) throw new RuntimeException('twitch_bad_json');
  return $json;
}

function twitchToken(array $credentials, bool $refresh = false): string {
  $file = dataDir() . '/cache/twitch-token.json';
  if (!$refresh && is_file($file)) {
    $saved = json_decode((string)@file_get_contents($file), true);
    if (is_array($saved) && ($saved['expires_at'] ?? 0) > time() + 60 && !empty($saved['access_token'])) return $saved['access_token'];
  }
  $body = http_build_query(['client_id' => $credentials['client_id'], 'client_secret' => $credentials['client_secret'], 'grant_type' => 'client_credentials']);
  $response = twitchRequest('https://id.twitch.tv/oauth2/token', ['Content-Type: application/x-www-form-urlencoded'], $body);
  if (empty($response['access_token']) || empty($response['expires_in'])) throw new RuntimeException('twitch_token_invalid');
  $token = ['access_token' => $response['access_token'], 'expires_at' => time() + (int)$response['expires_in']];
  $tmp = tempnam(dataDir() . '/cache', 'twitch-token-');
  if ($tmp === false) throw new RuntimeException('twitch_token_cache_failed');
  @chmod($tmp, 0600);
  if (@file_put_contents($tmp, json_encode($token), LOCK_EX) === false || !@rename($tmp, $file)) {
    @unlink($tmp); throw new RuntimeException('twitch_token_cache_failed');
  }
  return $token['access_token'];
}

function kickToken(array $credentials, bool $refresh = false): string {
  $file = dataDir() . '/cache/kick-token.json';
  if (!$refresh && is_file($file)) {
    $saved = json_decode((string)@file_get_contents($file), true);
    if (is_array($saved) && ($saved['expires_at'] ?? 0) > time() + 60 && !empty($saved['access_token'])) return $saved['access_token'];
  }
  $body = http_build_query(['grant_type' => 'client_credentials', 'client_id' => $credentials['client_id'], 'client_secret' => $credentials['client_secret']]);
  $response = twitchRequest('https://id.kick.com/oauth/token', ['Content-Type: application/x-www-form-urlencoded'], $body);
  if (empty($response['access_token']) || empty($response['expires_in'])) throw new RuntimeException('kick_token_invalid');
  $token = ['access_token' => $response['access_token'], 'expires_at' => time() + (int)$response['expires_in']];
  $tmp = tempnam(dataDir() . '/cache', 'kick-token-');
  if ($tmp === false) throw new RuntimeException('kick_token_cache_failed');
  @chmod($tmp, 0600);
  if (@file_put_contents($tmp, json_encode($token), LOCK_EX) === false || !@rename($tmp, $file)) {
    @unlink($tmp); throw new RuntimeException('kick_token_cache_failed');
  }
  return $token['access_token'];
}

function kickRequest(string $query, array $credentials): array {
  for ($attempt = 0; $attempt < 2; $attempt++) {
    try { return twitchRequest('https://api.kick.com/public/v1/livestreams?' . $query,
      ['Authorization: Bearer ' . kickToken($credentials, $attempt > 0)]); }
    catch (RuntimeException $e) { if ($e->getMessage() !== 'twitch_http_401' || $attempt) throw $e; }
  }
  throw new RuntimeException('kick_auth_failed');
}

function kickStreams(array $credentials): array {
  $query = 'category_id=14&limit=100&sort=viewer_count';
  $all = kickRequest($query, $credentials)['data'] ?? null;
  $ru = kickRequest($query . '&language=ru', $credentials)['data'] ?? null;
  if (!is_array($all) || !is_array($ru)) throw new RuntimeException('kick_streams_invalid');
  $merged = [];
  foreach (array_merge($ru, $all) as $row) {
    if (!is_array($row) || empty($row['broadcaster_user_id']) || !empty($row['has_mature_content'])) continue;
    $merged[(string)$row['broadcaster_user_id']] = $row;
  }
  $streams = [];
  foreach ($merged as $row) {
    $slug = (string)($row['slug'] ?? '');
    if (!preg_match('/^[a-z0-9_-]{1,40}$/i', $slug)) continue;
    $streams[] = ['platform' => 'kick', 'slug' => $slug, 'name' => $slug,
      'title' => (string)($row['stream_title'] ?? ''), 'lang' => strtolower((string)($row['language'] ?? '')),
      'viewers' => max(0, (int)($row['viewer_count'] ?? 0)), 'started_at' => (string)($row['started_at'] ?? ''),
      'thumb' => (string)($row['thumbnail'] ?? ''), 'avatar' => (string)($row['profile_picture'] ?? '')];
  }
  usort($streams, fn($a, $b) => (($b['lang'] === 'ru') <=> ($a['lang'] === 'ru')) ?: ($b['viewers'] <=> $a['viewers']));
  return ['ok' => true, 'updated_at' => gmdate('c'), 'streams' => $streams];
}

function twitchHelix(string $path, array $credentials): array {
  for ($attempt = 0; $attempt < 2; $attempt++) {
    try { return twitchRequest('https://api.twitch.tv/helix/' . $path,
      ['Client-Id: ' . $credentials['client_id'], 'Authorization: Bearer ' . twitchToken($credentials, $attempt > 0)]); }
    catch (RuntimeException $e) { if ($e->getMessage() !== 'twitch_http_401' || $attempt) throw $e; }
  }
  throw new RuntimeException('twitch_auth_failed');
}

function twitchStreams(array $credentials): array {
  $all = twitchHelix('streams?game_id=29595&first=100', $credentials)['data'] ?? [];
  $ru = twitchHelix('streams?game_id=29595&language=ru&first=100', $credentials)['data'] ?? [];
  if (!is_array($all) || !is_array($ru)) throw new RuntimeException('twitch_streams_invalid');
  $merged = [];
  foreach (array_merge($ru, $all) as $row) if (is_array($row) && !empty($row['user_id'])) $merged[(string)$row['user_id']] = $row;
  $avatars = [];
  foreach (array_chunk(array_keys($merged), 100) as $ids) {
    $query = implode('&', array_map(fn($id) => 'id=' . rawurlencode($id), $ids));
    foreach (twitchHelix('users?' . $query, $credentials)['data'] ?? [] as $user) $avatars[(string)$user['id']] = (string)($user['profile_image_url'] ?? '');
  }
  $streams = [];
  foreach ($merged as $id => $row) {
    $login = (string)($row['user_login'] ?? '');
    if (!preg_match('/^[a-z0-9_]{1,25}$/i', $login)) continue;
    $streams[] = ['platform' => 'twitch', 'login' => $login, 'name' => (string)($row['user_name'] ?? $login),
      'title' => (string)($row['title'] ?? ''), 'lang' => strtolower((string)($row['language'] ?? '')),
      'viewers' => max(0, (int)($row['viewer_count'] ?? 0)), 'started_at' => (string)($row['started_at'] ?? ''),
      'thumb' => str_replace(['{width}', '{height}'], ['440', '248'], (string)($row['thumbnail_url'] ?? '')),
      'avatar' => $avatars[$id] ?? ''];
  }
  usort($streams, fn($a, $b) => (($b['lang'] === 'ru') <=> ($a['lang'] === 'ru')) ?: ($b['viewers'] <=> $a['viewers']));
  return ['ok' => true, 'updated_at' => gmdate('c'), 'streams' => $streams,
    'counts' => ['ru' => count(array_filter($streams, fn($s) => $s['lang'] === 'ru')), 'total' => count($streams)]];
}

function curatedStreams(): array {
  $channels = json_decode((string)@file_get_contents(__DIR__ . '/../data/streamers-ru.json'), true);
  if (!is_array($channels)) throw new RuntimeException('curated_list_missing');
  $streams = []; $handles = []; $multi = function_exists('curl_multi_init') ? curl_multi_init() : null;
  $deadline = microtime(true) + 6;
  foreach ($channels as $channel) {
    if (!is_array($channel) || !preg_match('/^[a-z0-9_]{1,25}$/i', (string)($channel['login'] ?? ''))) continue;
    $login = strtolower($channel['login']);
    $url = 'https://static-cdn.jtvnw.net/previews-ttv/live_user_' . $login . '-440x248.jpg';
    $streams[$login] = ['platform' => 'twitch', 'login' => $login, 'name' => (string)($channel['name'] ?? $login), 'title' => '',
      'lang' => (string)($channel['lang'] ?? 'ru'), 'viewers' => 0, 'started_at' => '',
      'thumb' => '', 'avatar' => '', 'live' => null];
    if ($multi !== null) {
      $handle = curl_init($url);
      curl_setopt_array($handle, [CURLOPT_NOBODY => true, CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_TIMEOUT => 3, CURLOPT_CONNECTTIMEOUT => 2, CURLOPT_USERAGENT => 'dotamate.ru']);
      curl_multi_add_handle($multi, $handle); $handles[$login] = $handle;
    } else {
      if (microtime(true) >= $deadline) continue;
      $context = stream_context_create(['http' => ['method' => 'HEAD', 'timeout' => min(1, max(0.001, $deadline - microtime(true))),
        'follow_location' => 0, 'ignore_errors' => true, 'header' => "User-Agent: dotamate.ru\r\n"]]);
      @file_get_contents($url, false, $context);
      $code = 0;
      foreach ($http_response_header ?? [] as $header) if (preg_match('#^HTTP/\S+\s+(\d+)#', $header, $m)) $code = (int)$m[1];
      $streams[$login]['live'] = $code === 200 ? true : (($code >= 300 && $code < 400) ? false : null);
    }
    if ($streams[$login]['live'] === true) $streams[$login]['thumb'] = $url;
  }
  if ($multi !== null) {
    $completed = [];
    do {
      $result = curl_multi_exec($multi, $running);
      while ($info = curl_multi_info_read($multi)) $completed[] = $info['handle'];
      $remaining = $deadline - microtime(true);
      if ($running && $result === CURLM_OK && $remaining > 0) curl_multi_select($multi, min(0.2, $remaining));
    } while ($running && $result === CURLM_OK && $remaining > 0);
    foreach ($handles as $login => $handle) {
      $code = !in_array($handle, $completed, true) || curl_errno($handle) ? 0 : curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
      $streams[$login]['live'] = $code === 200 ? true : (($code >= 300 && $code < 400) ? false : null);
      if ($streams[$login]['live'] === true) $streams[$login]['thumb'] = 'https://static-cdn.jtvnw.net/previews-ttv/live_user_' . $login . '-440x248.jpg';
      curl_multi_remove_handle($multi, $handle); curl_close($handle);
    }
    curl_multi_close($multi);
  }
  $streams = array_values($streams);
  usort($streams, fn($a, $b) => (($b['live'] === true) <=> ($a['live'] === true))
    ?: (($b['lang'] === 'ru') <=> ($a['lang'] === 'ru')) ?: strcasecmp($a['name'], $b['name']));
  $live = count(array_filter($streams, fn($s) => $s['live'] === true));
  return ['ok' => true, 'mode' => 'curated', 'updated_at' => gmdate('c'), 'streams' => $streams,
    'counts' => ['ru' => count(array_filter($streams, fn($s) => $s['lang'] === 'ru')),
      'total' => count($streams), 'live' => $live],
    'check_failed' => count($streams) > 0 && count(array_filter($streams, fn($s) => $s['live'] !== null)) === 0];
}

function handleStreams(): void {
  if ($_SERVER['REQUEST_METHOD'] !== 'GET') send(['ok' => false, 'reason' => 'method_not_allowed'], 405);
  $kickCredentials = json_decode((string)@file_get_contents(dataDir() . '/secrets/kick.json'), true);
  $twitchCredentials = json_decode((string)@file_get_contents(dataDir() . '/secrets/twitch.json'), true);
  $configured = fn($c) => is_array($c) && !empty($c['client_id']) && !empty($c['client_secret']);
  $providers = []; $streams = []; $stale = false; $updated = [];
  foreach (['kick', 'twitch'] as $provider) {
    $isKick = $provider === 'kick';
    if ($isKick && !$configured($kickCredentials)) {
      $providers['kick'] = ['ok' => false, 'stale' => false, 'reason' => 'not_configured']; continue;
    }
    $mode = $isKick ? 'api' : ($configured($twitchCredentials) ? 'helix' : 'curated');
    $key = $isKick ? 'kick-streams-v1' : ($mode === 'curated' ? 'twitch-streams-curated-v1' : 'twitch-streams-v1');
    $ttl = $mode === 'curated' ? 180 : 120;
    $cache = dataDir() . '/cache/' . $key . '.json';
    $isStale = is_file($cache) && time() - filemtime($cache) >= $ttl;
    try {
      $data = cached($key, $ttl, $isKick ? fn() => kickStreams($kickCredentials)
        : ($mode === 'curated' ? 'curatedStreams' : fn() => twitchStreams($twitchCredentials)));
      $status = ['ok' => true, 'stale' => $isStale];
      if (!$isKick) $status['mode'] = $mode;
      if (!empty($data['check_failed'])) $status['check_failed'] = true;
      $providers[$provider] = $status;
      $stale = $stale || $isStale;
      $updated[] = (string)($data['updated_at'] ?? '');
      foreach ($data['streams'] ?? [] as $stream) {
        if (is_array($stream)) { $stream['platform'] = $provider; $streams[] = $stream; }
      }
    } catch (Throwable $e) {
      $providers[$provider] = ['ok' => false, 'stale' => false, 'reason' => 'upstream_unavailable'];
      if (!$isKick) $providers[$provider]['mode'] = $mode;
    }
  }
  $counts = ['ru' => count(array_filter($streams, fn($s) => ($s['lang'] ?? '') === 'ru')),
    'total' => count($streams), 'kick' => count(array_filter($streams, fn($s) => $s['platform'] === 'kick')),
    'twitch' => count(array_filter($streams, fn($s) => $s['platform'] === 'twitch'))];
  $counts['live'] = count(array_filter($streams, fn($s) => $s['platform'] === 'twitch' && ($s['live'] ?? false) === true));
  send(['ok' => $providers['kick']['ok'] || $providers['twitch']['ok'], 'updated_at' => $updated ? min($updated) : null,
    'streams' => $streams, 'counts' => $counts, 'providers' => $providers,
    'mode' => $providers['twitch']['mode'] ?? null, 'stale' => $stale,
    'check_failed' => $providers['twitch']['check_failed'] ?? false,
    'reason' => $streams || $providers['kick']['ok'] || $providers['twitch']['ok'] ? null : 'upstream_unavailable']);
}
