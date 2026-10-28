# AGENTS.md

<!-- handoff:learnings:begin -->
## Session Learnings (auto-updated by handoff)

### Implicit Rules
- Stack: static HTML/CSS + vanilla JS, PHP API (deploy/api), Node builders in tools/, JSON data; never hand-edit deploy/
- Deploy only after owner 'yes'; via bridge Claude outputs/claude-shell.cmd (shell/in → out, alive.txt), jobs wNN.cmd/.sh: push-server && sshr bash -s with heavy.lock, rebuild ALL pages after push, sync-deploy, deploy-hostiman, verify /api/version
- No deploy during daily-update 04:17 and 10:17 MSK; finish deploy if it fails after push-server
- Server: s278486@ruvip72.hostiman.ru port 8228, key ~/.ssh/dotamate_hostiman (sshr.js); home /var/www/s278486/data; code ~/dotamate-src; collector ~/dotamate-collector
- Helper PC: a1@192.168.0.7, key %USERPROFILE%\.ssh\dotamate_lan; main PC uses AmneziaVPN, LAN reachable via 'Ethernet 2'
- Data-independence (owner policy 2026-10-28): own Steam/replay data is primary; Stratz/OpenDota may be used within free limits (10–15% reserve, about 1 req/s), with no paid keys or extra accounts. See `docs/architecture/data-independence.md`.
- Russian replies to owner, short; owner is non-programmer; Codex prompts in English; Codex limits nearly exhausted

### Key Decisions
- Decision: separate ranked-Steam matrix for pair/matchup search — Reason: keep our-matrix.json contract and consumers unchanged
- Superseded 2026-10-28: item timings only from replays with verified per-player purchase-log flag; Stratz timings removed from item pages. Current block policy is in `docs/architecture/data-independence.md`.
- Decision: no service labels on site; empty blocks hidden (.hm-summary/.hm-board :empty, 2-column board via :has when bans absent) — Reason: owner rule
- Decision: D2PT builders run as optional steps in tools/daily-update.js after build-stats — Reason: failure keeps last file, never blocks daily
- Decision: helper PC takes odd match_ids (DOTAMATE_WORKER=1), skips ids done/skipped in server _state.json synced as server-state.json; server takes only even ids while archive/remote-worker.heartbeat <20 min — Reason: avoid duplicate parsing, auto-fallback when PC off
- Decision: helper ships via rsync to ~/dotamate-collector/incoming, server imports with tools/replay/import-remote.js under collect.lock — Reason: no race with collect.js index/state writes
- Decision: helper uses only 12 Steam accounts absent on server (server has 11) — Reason: per-account ~90 salt/day limit tracked separately
- Decision: helper runtime without sudo: portable node22 + Temurin JRE21 in ~/dotamate-collector, user crontab @reboot and */10 with flock — Reason: no root password over BatchMode ssh

<!-- handoff:learnings:end -->
