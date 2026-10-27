---
date: 2026-10-26T22:28:02.949Z
project: DOTAMATE
session: 8ca402b1
schema_version: 1
next_steps_count: 7
has_blockers: false
keywords: dotamate, d2pt features, replay helper pc, import-remote, daily-update, home page, steam accounts, deploy
headline: Goal: add D2PT-style analytics to DotaMate (meta by role, home summary, patch shifts, Radiant/Dire, item timings, matchu
---

# Session Handoff Snapshot
> **Generated:** 27.10.2026, 01:28:02

## 🎯 High-Level Objective
* **Goal:** Goal: add D2PT-style analytics to DotaMate (meta by role, home summary, patch shifts, Radiant/Dire, item timings, matchups, tier lists, Hero Grid, pubs vs pro, live) using only independent Steam/replay data; scale replay parsing via home helper PC. Intent: more engaging, SEO-rich content for monetization while honoring data-independence rule.

## 📌 Current State & Next Steps
* **Status:** Done: stages A–O,V; site v129 live, all deploy checks passed; daily-update wired; helper PC parsing ~10 matches/4 min and shipping to server. Remaining: stages P,Q (lane data unverified), R,S (need two patches of history), T,U,W; role-meta/tier pages/Hero Grid empty (0 audited role replays); item timings empty until verified-purchase replays accumulate; our-matrix.json/our-meta.json still old OpenDota sample feeding /draft/, /stats/, meta, hero pages (data-independence violation, unresolved); ~900 uncommitted files.
* **Next Action:** Check night daily-update log (04:17 MSK) for D2PT builder steps and import-remote coexistence

### Remaining Queue
- [ ] Remind owner: commit ~900 files in GitHub Desktop; install bzip2 on helper (sudo apt install -y bzip2); pin 192.168.0.7 DHCP reservation
- [ ] Monitor helper worker.log: Steam Guard prompts, last account (split login:password) validity
- [ ] Resolve our-matrix.json/our-meta.json OpenDota sample used by /draft/, /stats/, meta, hero pages
- [ ] Role replay audit to unlock role-meta, tier pages, Hero Grid download
- [ ] Remaining plan stages P–U,W when Codex limits restore
- [ ] Add Steam accounts gradually toward ~40 for helper full load; pass only new ones to PC

## 🛠️ Modified Files Delta
* build-pages.js: home summary/bans fallbacks return empty, no service phrases (backup Claude outputs/build-pages.js.bak-bans)
* css/home-hero.css: :empty hide for .hm-summary/.hm-board; 2-col board via :has; mobile override
* build-item-pages.js: removed 'Собираем данные' notes (backup Claude outputs/build-item-pages.js.bak-w32)
* tools/build-patch-snapshots.js: export steamRows (fixed side-stats/matchup-search crash)
* tools/daily-update.js: statsOk var; optional D2PT builder loop before build-pages (backup Claude outputs/daily-update.js.bak-w33)
* tools/replay/collect.js: WORKER odd-shard, server even-shard on fresh heartbeat, server-state skip, no pro candidates for worker (backup Claude outputs/collect.js.bak-lan; server backup collect.js.bak-lan)
* tools/replay/import-remote.js: new — imports helper matches, purchases, index entries under collect.lock
* Claude outputs/shell/w32-w35.sh/.cmd: deploy jobs
* Claude outputs/lan/run.sh, setup*.sh, chk2.sh: helper PC worker and checks (Steam-pc.txt wiped)
* Codex (stages A–O,V): many tools/build-*.js, js/side-stats.js, js/matchup-search.js, js/stats.js, js/live.js, tier/hero-grid/item-timings builders, tests, docs/architecture/{statistics,data-independence}.md, docs/plans/d2pt-features-plan.md

## 🚫 Failed Approaches (DO NOT RETRY)
* Approach: run build-stats in deploy job with --max-old-space-size=900 → Result: OOM, home meta failed provenance, home showed service text (v126-127) → Lesson: run build-stats without heap cap like daily
* Approach: multi-line .cmd placed directly in bridge shell/in → Result: 'The batch file cannot be found', later lines skipped → Lesson: write commands to separate .cmd, put one-line call/start stub in in/
* Approach: pkill -f dotamate/run.sh inside remote ssh command → Result: killed own ssh shell, no output → Lesson: avoid pattern matching own command line; rely on cron restart
* Approach: echo pubkey >> server authorized_keys → Result: last line had no newline, key merged into previous line, auth denied → Lesson: check trailing newline before append
* Approach: first helper runs without server state → Result: re-parsed matches server already had (IMPORTED 0) → Lesson: sync server _state.json each loop
* Approach: parse Steam.txt with awk NF → Result: misaligned pairs due to CRLF blank lines → Lesson: parse with trim+filter; last new account was login:password on one line, split on first colon

## 🔑 Crucial Context & Implicit Rules
* Stack: static HTML/CSS + vanilla JS, PHP API (deploy/api), Node builders in tools/, JSON data; never hand-edit deploy/
* Deploy only after owner 'yes'; via bridge Claude outputs/claude-shell.cmd (shell/in → out, alive.txt), jobs wNN.cmd/.sh: push-server && sshr bash -s with heavy.lock, rebuild ALL pages after push, sync-deploy, deploy-hostiman, verify /api/version
* No deploy during daily-update 04:17 and 10:17 MSK; finish deploy if it fails after push-server
* Server: s278486@ruvip72.hostiman.ru port 8228, key ~/.ssh/dotamate_hostiman (sshr.js); home /var/www/s278486/data; code ~/dotamate-src; collector ~/dotamate-collector
* Helper PC: a1@192.168.0.7, key %USERPROFILE%\.ssh\dotamate_lan; main PC uses AmneziaVPN, LAN reachable via 'Ethernet 2'
* Data-independence: OpenDota/Stratz not allowed for public stats
* Russian replies to owner, short; owner is non-programmer; Codex prompts in English; Codex limits nearly exhausted

## Key Decisions
- Decision: separate ranked-Steam matrix for pair/matchup search — Reason: keep our-matrix.json contract and consumers unchanged
- Decision: item timings only from replays with verified per-player purchase-log flag; Stratz timings removed from item pages — Reason: data-independence rule, prevent wrong timings
- Decision: no service labels on site; empty blocks hidden (.hm-summary/.hm-board :empty, 2-column board via :has when bans absent) — Reason: owner rule
- Decision: D2PT builders run as optional steps in tools/daily-update.js after build-stats — Reason: failure keeps last file, never blocks daily
- Decision: helper PC takes odd match_ids (DOTAMATE_WORKER=1), skips ids done/skipped in server _state.json synced as server-state.json; server takes only even ids while archive/remote-worker.heartbeat <20 min — Reason: avoid duplicate parsing, auto-fallback when PC off
- Decision: helper ships via rsync to ~/dotamate-collector/incoming, server imports with tools/replay/import-remote.js under collect.lock — Reason: no race with collect.js index/state writes
- Decision: helper uses only 12 Steam accounts absent on server (server has 11) — Reason: per-account ~90 salt/day limit tracked separately
- Decision: helper runtime without sudo: portable node22 + Temurin JRE21 in ~/dotamate-collector, user crontab @reboot and */10 with flock — Reason: no root password over BatchMode ssh

## 🙋 User Contribution (human-authored)
Installed Ubuntu on helper PC, enabled SSH, created LAN key and copied it, adjusted AmneziaVPN for LAN, added Steam accounts to secrets/Steam.txt, reported home page errors via screenshots.

## 🙋 User Decisions (made by the human)
- **Implement all D2PT features except abnormal-winrate players and support block**
  - Reason: Owner choice after comparison
- **Deploy completed work immediately and have Claude finish server wiring itself**
  - Reason: Codex at 8% limits
- **Use second home PC (Ubuntu) as temporary helper for replay parsing, max load while on**
  - Rejected: 1 GB VDS from vdsina

## Summary
Audited dota2protracker vs DotaMate (Codex luna). Codex sol wrote plan docs/plans/d2pt-features-plan.md (23 stages) and implemented A–O,V. Claude deployed v126 (code), v127 (D2PT data builders on server: side-stats/matchup-search over 4.9M matches, patch snapshots), v128 (build-stats rebuilt, home meta restored), v129 (service labels removed from home, bans column hidden). Wired D2PT builders into daily-update. Set up Ubuntu helper PC 192.168.0.7 as odd-id replay worker; verified IMPORTED 10/19 per batch, no duplicates.

---
*A short hint surfaces on session start; full context loads only if your next prompt matches a keyword above, or via manual `/handoff-resume`. The same record is available as a sibling `.json` file for external tools.*