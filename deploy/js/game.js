// Dota Mate — mini-game "Hook & Hit".
// Ported from a standalone single-file prototype into the site's own page.
// Wrapped in an IIFE (no globals leak into the page) and wired to prefixed
// "dg*" element ids/classes so nothing here can ever collide with or override
// the rest of the site's markup, styles or globals.
(function () {
  const canvas = document.getElementById('dgCanvas');
  if (!canvas) return; // section not on this page — nothing to do
  const ctx = canvas.getContext('2d', { alpha: false });

  const goldDisplay = document.getElementById('dgGold');
  const livesDisplay = document.getElementById('dgLives');
  const timerDisplay = document.getElementById('dgTimer');
  const livesBox = document.getElementById('dgLivesBox');
  const endGameBtn = document.getElementById('dgEndBtn');

  const startScreen = document.getElementById('dgStart');
  const gameoverScreen = document.getElementById('dgOver');
  const startClassicBtn = document.getElementById('dgStartClassic');
  const startEndlessBtn = document.getElementById('dgStartEndless');
  const restartBtn = document.getElementById('dgRestart');
  const stage = document.getElementById('dgStage');
  const fullscreenBtn = document.getElementById('dgFullscreen');
  const streakDisplay = document.getElementById('dgStreak');
  const bestLine = document.getElementById('dgBest');

  let gameState = 'START';
  let gameMode = 'CLASSIC';
  let gold = 0, lastHits = 0, deflectedCount = 0, lives = 3, gameTime = 0;
  let lastTime = 0, animId = null;
  let skillSpawnTimer = 0, creepSpawnTimer = 0;
  let lastSpeedStage = 0;
  let autoPaused = false;

  // Бесконечный режим: попадание хука стоит золота, на нуле игра заканчивается.
  // Стартовый запас обязателен — без него первый же хук завершал бы игру при
  // счёте 0, ещё до того как игрок успел добить хоть одного крипа.
  const ENDLESS_START_GOLD = 200;
  const HOOK_GOLD_PENALTY = 20;
  const LOW_GOLD_AT = HOOK_GOLD_PENALTY * 3;
  const BEST_STORAGE_KEY = 'dgBest.v1';

  let goldEarned = 0;   // заработано за игру, без стартового запаса
  let streak = 0;       // добиваний подряд, промах обнуляет
  let bestStreak = 0;
  let lowGoldOn = false;

  let isPointerDown = false, isLockingTarget = false, activePointerId = null;
  let mousePos = { x: 400, y: 300 };

  const hero = {
    x: 400, y: 300, targetX: 400, targetY: 300, targetUnit: null,
    radius: 18, baseSpeed: 420, speedBoostTimer: 0, attackRange: 190, attackCooldown: 0, attackRate: 0.35, damage: 40
  };

  const projectiles = Array.from({ length: 20 }, () => ({ active: false, x: 0, y: 0, target: null, speed: 850, radius: 5 }));
  const creeps = Array.from({ length: 15 }, () => ({ active: false, x: 0, y: 0, radius: 18, maxHp: 100, hp: 100, bounty: 45, decayRate: 15 }));
  const skillshots = Array.from({ length: 20 }, () => ({ active: false, isSkillshot: true, type: 'hook', deflected: false, x: 0, y: 0, vx: 0, vy: 0, radius: 12, color: '#ffeb3b', speed: 0 }));
  // Pool bumped from the original 50: several effects (a deflect, a last hit and
  // a hook-to-face can land in the same frame) each spawn a batch, and 50 slots
  // could occasionally run dry and visibly truncate the burst.
  const particles = Array.from({ length: 90 }, () => ({ active: false, x: 0, y: 0, vx: 0, vy: 0, radius: 2, color: '#fff', life: 0 }));

  const clickMarkers = [];
  const floatingTexts = [];

  function getDistSq(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    return dx * dx + dy * dy;
  }

  function formatTime(s) {
    return `${Math.floor(s / 60).toString().padStart(2, '0')}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  }

  function vibrate(pattern) {
    // Вибрации нет на десктопе и запрещена в iOS Safari — молча пропускаем.
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (_) {}
  }

  // Серия добиваний: каждый следующий крип подряд дороже, на шестом множитель
  // упирается в потолок x2. Пропущенный хук серию обнуляет.
  function streakMultiplier() {
    return 1 + Math.min(Math.max(streak - 1, 0), 5) * 0.2;
  }

  function loadBest() {
    // Приватный режим и запрет хранилища кидают исключение — рекорд не критичен.
    try {
      const raw = localStorage.getItem(BEST_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }

  function saveBest(data) {
    try { localStorage.setItem(BEST_STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
  }

  function renderBestOnStart() {
    if (!bestLine) return;
    const best = loadBest();
    const parts = [];
    if (best.classic) parts.push(`классика — ${best.classic.gold}`);
    if (best.endless) parts.push(`бесконечный — ${best.endless.gold}`);
    if (!parts.length) { bestLine.classList.add('dg-hide'); return; }
    bestLine.innerText = 'Ваш рекорд по заработанному золоту: ' + parts.join(', ');
    bestLine.classList.remove('dg-hide');
  }

  function spawnParticlesBatch(x, y, color, count, speedMult = 1) {
    for (let i = 0; i < count; i++) {
      const p = particles.find(item => !item.active);
      if (!p) break;
      p.active = true;
      p.x = x; p.y = y; p.color = color;
      p.radius = Math.random() * 2.5 + 1.5;
      const angle = Math.random() * Math.PI * 2;
      const speed = (Math.random() * 120 + 40) * speedMult;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.life = 0.35;
    }
  }

  function spawnCreep() {
    const c = creeps.find(item => !item.active);
    if (!c) return;
    c.active = true;
    c.x = 80 + Math.random() * 640;
    c.y = 80 + Math.random() * 440;
    c.hp = c.maxHp = 100;
    c.decayRate = 10 + Math.random() * 12;
  }

  function spawnSkillshot() {
    const s = skillshots.find(item => !item.active);
    if (!s) return;

    const rand = Math.random();
    s.deflected = false;

    const speedStage = Math.floor(gameTime / 20);
    const speedMultiplier = Math.min(0.6 + speedStage * 0.2, 1.8);

    let baseSpeed = 350;
    if (rand < 0.35) {
      s.type = 'red'; s.radius = 15; s.color = '#ff5252'; baseSpeed = 310;
    } else if (rand < 0.70) {
      s.type = 'hook'; s.radius = 14; s.color = '#ffeb3b'; baseSpeed = 360;
    } else {
      s.type = 'fast'; s.radius = 10; s.color = '#00bcd4'; baseSpeed = 430;
    }

    s.speed = baseSpeed * speedMultiplier;

    const side = Math.floor(Math.random() * 4);
    if (side === 0) { s.x = Math.random() * 800; s.y = -30; }
    else if (side === 1) { s.x = 830; s.y = Math.random() * 600; }
    else if (side === 2) { s.x = Math.random() * 800; s.y = 630; }
    else { s.x = -30; s.y = Math.random() * 600; }

    const angle = Math.atan2(hero.y - s.y, hero.x - s.x) + (Math.random() - 0.5) * 0.15;
    s.vx = Math.cos(angle) * s.speed;
    s.vy = Math.sin(angle) * s.speed;
    s.active = true;
  }

  function attackTarget(target) {
    if (hero.attackCooldown > 0) return;
    const p = projectiles.find(item => !item.active);
    if (!p) return;

    p.active = true; p.x = hero.x; p.y = hero.y; p.target = target;
    hero.attackCooldown = hero.attackRate;
  }

  function deflectSkillshot(s) {
    if (!s || !s.active || s.deflected) return;
    s.deflected = true;
    s.vx = -s.vx * 1.5; s.vy = -s.vy * 1.5;
    s.color = '#ff9800';
    gold += 30; goldEarned += 30; deflectedCount++;
    vibrate(25);
    updateUI();
    spawnParticlesBatch(s.x, s.y, '#ff5252', 10);
    spawnParticlesBatch(s.x, s.y, '#ffd700', 8);
    floatingTexts.push({ x: s.x, y: s.y - 10, text: 'ОТБИТ! +30', color: '#ffeb3b', alpha: 1.0 });

    if (hero.targetUnit === s) {
      hero.targetUnit = null;
      isLockingTarget = false;
    }
  }

  function updateUI() {
    goldDisplay.innerText = gold;
    timerDisplay.innerText = formatTime(gameTime);
    if (gameMode === 'CLASSIC') livesDisplay.innerText = '♥'.repeat(Math.max(0, lives));

    // Золото на исходе — подсвечиваем счётчик, чтобы конец не был внезапным.
    const low = gameMode === 'ENDLESS' && gameState === 'PLAYING' && gold <= LOW_GOLD_AT;
    if (low !== lowGoldOn) {
      lowGoldOn = low;
      goldDisplay.classList.toggle('dg-gold-low', low);
    }

    if (streakDisplay) {
      if (streak >= 2) {
        streakDisplay.innerText = `x${streakMultiplier().toFixed(1)}`;
        streakDisplay.classList.remove('dg-hide');
      } else {
        streakDisplay.classList.add('dg-hide');
      }
    }
  }

  function getCanvasPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (800 / Math.max(1, rect.width));
    const y = (clientY - rect.top) * (600 / Math.max(1, rect.height));

    return {
      rawX: x, rawY: y,
      x: Math.max(hero.radius, Math.min(800 - hero.radius, x)),
      y: Math.max(50 + hero.radius, Math.min(600 - hero.radius, y))
    };
  }

  function findClickedTarget(x, y) {
    let closest = null, closestDistSq = Infinity;

    for (const s of skillshots) {
      if (!s.active || s.type !== 'red' || s.deflected) continue;
      const distSq = getDistSq(x, y, s.x, s.y);
      const hitArea = s.radius + 34;
      if (distSq <= hitArea * hitArea && distSq < closestDistSq) {
        closest = s; closestDistSq = distSq;
      }
    }

    if (!closest) {
      for (const c of creeps) {
        if (!c.active || c.hp <= 0) continue;
        const distSq = getDistSq(x, y, c.x, c.y);
        const hitArea = c.radius + 34;
        if (distSq <= hitArea * hitArea && distSq < closestDistSq) {
          closest = c; closestDistSq = distSq;
        }
      }
    }

    return closest;
  }

  function handleInput(clientX, clientY, isDownEvent) {
    if (gameState !== 'PLAYING') return;

    mousePos.x = clientX; mousePos.y = clientY;
    const pt = getCanvasPoint(clientX, clientY);

    if (isDownEvent) {
      hero.speedBoostTimer = 0.6;
      spawnParticlesBatch(hero.x, hero.y, '#64b5f6', 6, 0.5);
    }

    const clickedTarget = findClickedTarget(pt.rawX, pt.rawY);

    if (clickedTarget) {
      hero.targetUnit = clickedTarget;
      isLockingTarget = true;
      if (isDownEvent) {
        clickMarkers.push({ x: clickedTarget.x, y: clickedTarget.y, type: 'red', radius: 3, alpha: 1.0 });
      }

      const attackDist = hero.attackRange + clickedTarget.radius;
      if (getDistSq(hero.x, hero.y, clickedTarget.x, clickedTarget.y) <= attackDist * attackDist) {
        attackTarget(clickedTarget);
      }
    } else {
      hero.targetUnit = null;
      isLockingTarget = false;
      hero.targetX = pt.x;
      hero.targetY = pt.y;

      if (isDownEvent) {
        clickMarkers.push({ x: pt.x, y: pt.y, type: 'green', radius: 3, alpha: 1.0 });
      }
    }
    if (clickMarkers.length > 6) clickMarkers.shift();
  }

  function update(dt) {
    gameTime += dt;
    timerDisplay.innerText = formatTime(gameTime);

    const currentStage = Math.floor(gameTime / 20);
    if (currentStage > lastSpeedStage && currentStage <= 6) {
      lastSpeedStage = currentStage;
      floatingTexts.push({ x: hero.x, y: hero.y - 35, text: 'СКОРОСТЬ ХУКОВ ВЫРОСЛА!', color: '#ff5252', alpha: 1.5 });
    }

    if (isPointerDown) handleInput(mousePos.x, mousePos.y, false);
    if (hero.attackCooldown > 0) hero.attackCooldown -= dt;

    if (hero.speedBoostTimer > 0) {
      hero.speedBoostTimer -= dt;
    }

    for (let i = clickMarkers.length - 1; i >= 0; i--) {
      const m = clickMarkers[i];
      m.radius += dt * 50; m.alpha -= dt * 3.5;
      if (m.alpha <= 0) clickMarkers.splice(i, 1);
    }

    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const ft = floatingTexts[i];
      ft.y -= 35 * dt; ft.alpha -= dt * 1.0;
      if (ft.alpha <= 0) floatingTexts.splice(i, 1);
    }

    let isMoving = false, destX = hero.targetX, destY = hero.targetY;

    if (hero.targetUnit) {
      const deadCreep = !hero.targetUnit.isSkillshot && hero.targetUnit.hp <= 0;
      const deflectedHook = hero.targetUnit.isSkillshot && hero.targetUnit.deflected;

      if (!hero.targetUnit.active || deadCreep || deflectedHook) {
        hero.targetUnit = null; isLockingTarget = false;
        hero.targetX = hero.x; hero.targetY = hero.y;
      } else {
        destX = hero.targetUnit.x; destY = hero.targetUnit.y;
        const attackThresh = (hero.attackRange + hero.targetUnit.radius) ** 2;
        if (getDistSq(hero.x, hero.y, destX, destY) <= attackThresh) {
          attackTarget(hero.targetUnit);
          hero.targetX = hero.x; hero.targetY = hero.y;
        } else {
          isMoving = true;
        }
      }
    } else if (getDistSq(hero.x, hero.y, destX, destY) > 1) {
      isMoving = true;
    }

    if (isMoving) {
      const dist = Math.sqrt(getDistSq(hero.x, hero.y, destX, destY));

      const currentSpeed = hero.speedBoostTimer > 0 ? hero.baseSpeed * 1.5 : hero.baseSpeed;
      const moveStep = currentSpeed * dt;

      if (dist <= moveStep) {
        hero.x = destX; hero.y = destY;
      } else {
        hero.x += ((destX - hero.x) / dist) * moveStep;
        hero.y += ((destY - hero.y) / dist) * moveStep;
      }

      if (hero.speedBoostTimer > 0 && Math.random() < 0.4) {
        spawnParticlesBatch(hero.x, hero.y, '#90caf9', 1, 0.2);
      }
    }

    hero.x = Math.max(hero.radius, Math.min(800 - hero.radius, hero.x));
    hero.y = Math.max(50 + hero.radius, Math.min(600 - hero.radius, hero.y));

    for (let p of projectiles) {
      if (!p.active) continue;

      for (let s of skillshots) {
        if (s.active && s.type === 'red' && !s.deflected) {
          if (getDistSq(p.x, p.y, s.x, s.y) <= (p.radius + s.radius + 6) ** 2) {
            deflectSkillshot(s);
            p.active = false; p.target = null;
            break;
          }
        }
      }

      if (!p.active) continue;
      if (!p.target || !p.target.active || p.target.deflected) {
        p.active = false; p.target = null;
        continue;
      }

      const dx = p.target.x - p.x, dy = p.target.y - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const hitStep = p.speed * dt;

      if (dist <= hitStep) {
        const target = p.target;
        if (target.isSkillshot) {
          deflectSkillshot(target);
        } else {
          target.hp -= hero.damage;
          if (target.hp <= 0 && target.active) {
            target.active = false; lastHits++;
            streak++;
            if (streak > bestStreak) bestStreak = streak;
            const mult = streakMultiplier();
            const reward = Math.round(target.bounty * mult);
            gold += reward; goldEarned += reward;
            updateUI();
            spawnParticlesBatch(target.x, target.y, '#ffd700', 8);
            floatingTexts.push({
              x: target.x, y: target.y - 10,
              text: mult > 1 ? `+${reward} x${mult.toFixed(1)}` : `+${reward}`,
              color: '#ffd700', alpha: 1.0
            });

            if (hero.targetUnit === target) {
              hero.targetUnit = null; isLockingTarget = false;
            }
          }
        }
        p.active = false; p.target = null;
      } else {
        p.x += (dx / dist) * hitStep; p.y += (dy / dist) * hitStep;
      }
    }

    let activeCreeps = 0;
    for (let c of creeps) {
      if (!c.active) continue;
      activeCreeps++;
      c.hp -= c.decayRate * dt;
      if (c.hp <= 0) {
        c.active = false;
        if (hero.targetUnit === c) { hero.targetUnit = null; isLockingTarget = false; }
      }
    }

    creepSpawnTimer += dt;
    if (creepSpawnTimer > 1.8 || activeCreeps < 2) {
      if (activeCreeps < 4) spawnCreep();
      creepSpawnTimer = 0;
    }

    for (let s of skillshots) {
      if (!s.active) continue;
      const oldX = s.x, oldY = s.y;
      const stepX = s.vx * dt, stepY = s.vy * dt;
      s.x += stepX; s.y += stepY;

      if (!s.deflected) {
        const hitRadius = hero.radius + s.radius;
        const lenSq = stepX * stepX + stepY * stepY;
        let t = lenSq > 0 ? Math.max(0, Math.min(1, ((hero.x - oldX) * stepX + (hero.y - oldY) * stepY) / lenSq)) : 0;

        if (getDistSq(oldX + stepX * t, oldY + stepY * t, hero.x, hero.y) <= hitRadius * hitRadius) {
          s.active = false;
          spawnParticlesBatch(hero.x, hero.y, '#ff1744', 15);
          streak = 0;
          vibrate(60);
          if (gameMode === 'CLASSIC') {
            lives--; updateUI();
            if (lives <= 0) endGame();
          } else {
            gold = Math.max(0, gold - HOOK_GOLD_PENALTY);
            floatingTexts.push({ x: hero.x, y: hero.y - 35, text: `-${HOOK_GOLD_PENALTY}`, color: '#ff5252', alpha: 1.2 });
            updateUI();
            if (gold <= 0) endGame();
          }
          if (hero.targetUnit === s) { hero.targetUnit = null; isLockingTarget = false; }
          continue;
        }
      }

      if (s.x < -100 || s.x > 900 || s.y < -60 || s.y > 700) s.active = false;
    }

    skillSpawnTimer += dt;
    if (skillSpawnTimer > Math.max(0.45, 1.8 - gameTime / 90)) {
      spawnSkillshot();
      skillSpawnTimer = 0;
    }

    for (let pt of particles) {
      if (!pt.active) continue;
      pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.life -= dt;
      if (pt.life <= 0) pt.active = false;
    }
  }

  function render() {
    ctx.fillStyle = '#12171d';
    ctx.fillRect(0, 0, 800, 600);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < 800; x += 40) { ctx.moveTo(x, 50); ctx.lineTo(x, 600); }
    for (let y = 50; y < 600; y += 40) { ctx.moveTo(0, y); ctx.lineTo(800, y); }
    ctx.stroke();

    for (let c of creeps) {
      if (!c.active) continue;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.radius + 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(229, 57, 53, 0.10)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(c.x, c.y, c.radius, 0, Math.PI * 2);
      ctx.fillStyle = '#e53935';
      ctx.fill();

      const barX = c.x - 17, barY = c.y - 28;
      ctx.fillStyle = '#000';
      ctx.fillRect(barX - 1, barY - 1, 36, 6);
      const ratio = Math.max(0, c.hp / c.maxHp);
      ctx.fillStyle = ratio > 0.4 ? '#4caf50' : (ratio > 0.2 ? '#ff9800' : '#f44336');
      ctx.fillRect(barX, barY, 34 * ratio, 4);
    }

    for (let m of clickMarkers) {
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
      ctx.strokeStyle = m.type === 'green' ? `rgba(76, 175, 80, ${m.alpha})` : `rgba(244, 67, 54, ${m.alpha})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (hero.targetUnit && hero.targetUnit.active) {
      ctx.beginPath();
      ctx.arc(hero.targetUnit.x, hero.targetUnit.y, hero.targetUnit.radius + 6, 0, Math.PI * 2);
      ctx.strokeStyle = hero.targetUnit.isSkillshot ? 'rgba(255, 82, 82, 0.9)' : 'rgba(229, 57, 53, 0.7)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (hero.speedBoostTimer > 0) {
      ctx.beginPath();
      ctx.arc(hero.x, hero.y, hero.radius + 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(100, 181, 246, 0.25)';
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(hero.x, hero.y, hero.radius, 0, Math.PI * 2);
    ctx.fillStyle = hero.speedBoostTimer > 0 ? '#42a5f5' : '#2196F3';
    ctx.fill();
    ctx.strokeStyle = '#64B5F6';
    ctx.lineWidth = 3;
    ctx.stroke();

    for (let p of projectiles) {
      if (!p.active) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = '#64B5F6';
      ctx.fill();
    }

    for (let s of skillshots) {
      if (!s.active) continue;

      if (s.type === 'red' && !s.deflected) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius + 6 + Math.sin(gameTime * 12) * 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 23, 68, 0.35)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#ff1744';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
      }
    }

    for (let pt of particles) {
      if (!pt.active) continue;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.radius, 0, Math.PI * 2);
      ctx.fillStyle = pt.color;
      ctx.fill();
    }

    ctx.font = 'bold 14px Inter, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    for (let ft of floatingTexts) {
      ctx.fillStyle = ft.color;
      ctx.globalAlpha = Math.max(0, ft.alpha);
      ctx.fillText(ft.text, ft.x, ft.y);
    }
    ctx.globalAlpha = 1.0;
  }

  function gameLoop(timestamp) {
    if (gameState !== 'PLAYING') return;

    if (!lastTime) lastTime = timestamp;
    let dt = Math.min((timestamp - lastTime) / 1000, 0.033);
    lastTime = timestamp;

    try {
      update(dt);
      render();
    } catch (e) {
      console.error('Game loop error:', e);
    }

    animId = requestAnimationFrame(gameLoop);
  }

  function initGame(mode) {
    gameMode = mode;
    projectiles.forEach(p => p.active = false);
    creeps.forEach(c => c.active = false);
    skillshots.forEach(s => s.active = false);
    particles.forEach(pt => pt.active = false);
    clickMarkers.length = floatingTexts.length = 0;

    hero.x = hero.targetX = 400; hero.y = hero.targetY = 300;
    hero.targetUnit = null; hero.attackCooldown = 0; hero.speedBoostTimer = 0;
    isPointerDown = isLockingTarget = false;

    gold = lastHits = deflectedCount = gameTime = skillSpawnTimer = creepSpawnTimer = lastSpeedStage = 0;
    lives = 3;
    goldEarned = streak = bestStreak = 0;
    lowGoldOn = false;
    goldDisplay.classList.remove('dg-gold-low');
    if (streakDisplay) streakDisplay.classList.add('dg-hide');
    if (gameMode === 'ENDLESS') gold = ENDLESS_START_GOLD;

    if (gameMode === 'ENDLESS') {
      livesBox.classList.add('dg-hide');
      endGameBtn.classList.remove('dg-hide');
    } else {
      livesBox.classList.remove('dg-hide');
      endGameBtn.classList.add('dg-hide');
    }

    for (let i = 0; i < 3; i++) spawnCreep();
    updateUI();
  }

  function startGame(mode) {
    if (animId !== null) cancelAnimationFrame(animId);
    activePointerId = null;
    autoPaused = false;
    initGame(mode);
    gameState = 'PLAYING';
    lastTime = performance.now();
    startScreen.classList.add('dg-hide');
    gameoverScreen.classList.add('dg-hide');
    animId = requestAnimationFrame(gameLoop);
  }

  function endGame() {
    gameState = 'GAMEOVER';
    isPointerDown = isLockingTarget = false;
    activePointerId = null;
    autoPaused = false;
    if (animId !== null) cancelAnimationFrame(animId);
    animId = null;

    document.getElementById('dgOverTitle').innerText = (gameMode === 'ENDLESS') ? 'ИГРА ЗАВЕРШЕНА' : 'GAME OVER';
    document.getElementById('dgFinalTime').innerText = formatTime(gameTime);
    document.getElementById('dgFinalLh').innerText = lastHits;
    document.getElementById('dgFinalDeflect').innerText = deflectedCount;
    document.getElementById('dgFinalGold').innerText = goldEarned;
    const finalStreak = document.getElementById('dgFinalStreak');
    if (finalStreak) finalStreak.innerText = bestStreak;
    endGameBtn.classList.add('dg-hide');
    livesBox.classList.add('dg-hide');

    // Рекорд считаем по заработанному, иначе стартовый запас бесконечного
    // режима попадал бы в результат и завышал его на ровном месте.
    const best = loadBest();
    const key = (gameMode === 'ENDLESS') ? 'endless' : 'classic';
    const prev = best[key] || null;
    const isRecord = goldEarned > 0 && (!prev || goldEarned > prev.gold);
    if (isRecord) {
      best[key] = { gold: goldEarned, time: Math.round(gameTime), lastHits, streak: bestStreak };
      saveBest(best);
    }
    const recordLine = document.getElementById('dgRecord');
    if (recordLine) {
      if (isRecord) {
        recordLine.innerText = 'НОВЫЙ РЕКОРД!';
        recordLine.classList.remove('dg-hide');
      } else if (prev) {
        recordLine.innerText = `Рекорд этого режима: ${prev.gold} золота`;
        recordLine.classList.remove('dg-hide');
      } else {
        recordLine.classList.add('dg-hide');
      }
    }
    renderBestOnStart();

    gameoverScreen.classList.remove('dg-hide');
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (gameState !== 'PLAYING') return;
    e.preventDefault();
    if (activePointerId !== null && activePointerId !== e.pointerId) return;

    activePointerId = e.pointerId;
    isPointerDown = true;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    handleInput(e.clientX, e.clientY, true);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!isPointerDown || activePointerId !== e.pointerId) return;
    e.preventDefault();
    handleInput(e.clientX, e.clientY, false);
  });

  function releasePointer(e) {
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    isPointerDown = false; activePointerId = null;
    try { if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  }

  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  window.addEventListener('blur', () => { isPointerDown = false; activePointerId = null; });

  startClassicBtn.addEventListener('click', () => startGame('CLASSIC'));
  // Полный экран. iOS Safari разворачивает только видео, произвольный div —
  // нет, поэтому при отказе включаем CSS-подмену: тот же контейнер на весь
  // вьюпорт, без обращения к Fullscreen API.
  function nativeFsElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function fsActive() {
    return !!nativeFsElement() || stage.classList.contains('dg-fs');
  }

  function syncFsButton() {
    if (!fullscreenBtn) return;
    const on = fsActive();
    // Текст подписи рисует CSS: на узком экране он ужимается до значка, и
    // менять его из скрипта пришлось бы с дублированием медиазапроса.
    fullscreenBtn.dataset.state = on ? 'on' : 'off';
    fullscreenBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    fullscreenBtn.setAttribute('aria-label', on ? 'Свернуть игру' : 'Развернуть игру на весь экран');
    document.body.classList.toggle('dg-fs-lock', on);
  }

  function lockLandscape() {
    // Работает только внутри полного экрана и только на части устройств;
    // отказ штатный, поэтому ошибку глушим.
    try {
      if (screen.orientation && screen.orientation.lock) {
        const r = screen.orientation.lock('landscape');
        if (r && typeof r.catch === 'function') r.catch(() => {});
      }
    } catch (_) {}
  }

  function enterFullscreen() {
    const req = stage.requestFullscreen || stage.webkitRequestFullscreen;
    const fallback = () => { stage.classList.add('dg-fs'); syncFsButton(); };
    if (!req) return fallback();
    try {
      const r = req.call(stage);
      if (r && typeof r.then === 'function') {
        r.then(() => { lockLandscape(); syncFsButton(); }).catch(fallback);
      } else {
        lockLandscape(); syncFsButton();
      }
    } catch (_) { fallback(); }
  }

  function exitFullscreen() {
    stage.classList.remove('dg-fs');
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (_) {}
    const ex = document.exitFullscreen || document.webkitExitFullscreen;
    if (nativeFsElement() && ex) {
      try {
        const r = ex.call(document);
        if (r && typeof r.catch === 'function') r.catch(() => {});
      } catch (_) {}
    }
    syncFsButton();
  }

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', () => {
      if (fsActive()) exitFullscreen(); else enterFullscreen();
    });
  }

  document.addEventListener('fullscreenchange', syncFsButton);
  document.addEventListener('webkitfullscreenchange', syncFsButton);
  // Esc закрывает встроенный полный экран сам, а CSS-подмену — нет.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stage.classList.contains('dg-fs')) exitFullscreen();
  });

  renderBestOnStart();
  syncFsButton();

  startEndlessBtn.addEventListener('click', () => startGame('ENDLESS'));
  endGameBtn.addEventListener('click', endGame);
  restartBtn.addEventListener('click', () => {
    gameoverScreen.classList.add('dg-hide');
    startScreen.classList.remove('dg-hide');
    gameState = 'START';
    render();
  });

  // Auto-pause while the section is scrolled off-screen: a mid-air hook still
  // "landing" while the player is reading the guides section further down the
  // page would cost a life they never saw coming, and the loop just burns CPU
  // for no reason while nobody is looking. Freezing is as simple as not asking
  // for another frame -- nothing else in this game advances on its own.
  if ('IntersectionObserver' in window && stage) {
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      if (!entry.isIntersecting) {
        if (gameState === 'PLAYING' && animId !== null) {
          cancelAnimationFrame(animId);
          animId = null;
          autoPaused = true;
        }
      } else if (autoPaused && gameState === 'PLAYING') {
        autoPaused = false;
        lastTime = 0; // gameLoop treats a falsy lastTime as "first frame", so dt won't spike
        animId = requestAnimationFrame(gameLoop);
      }
    }, { threshold: 0.05 });
    observer.observe(stage);
  }

  render();
})();
