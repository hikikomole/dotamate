#!/usr/bin/env node
/**
 * Проверка расчёта «Разбора матча» (js/academy-analysis.js) на контрольных примерах.
 * Данные — синтетический эталон, а не data/stats.json: результат не зависит от свежести базы.
 * Каталог рекомендаций (гайды и этапы) дополнительно проверяет сборка — tools/academy-render.js.
 *
 * Запуск: node tools/check-academy-analysis.js  (код выхода 1 при ошибке)
 */
'use strict';
const path = require('path');
const A = require(path.join(__dirname, '..', 'js', 'academy-analysis.js'));
const { COURSES } = require(path.join(__dirname, '..', 'academy-content.js'));
const guides = new Set(require(path.join(__dirname, '..', 'guide-content.js')).map(g => g.slug));

let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.error('✗ ' + msg); } else console.log('✓ ' + msg); }
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

const hero = (id, n, x) => Object.assign({ id, n, wr: 50, lo: 48 }, x);
const stats = {
  base: { patch: 'test', duration: [[30, 100], [40, 100]] },          // средняя длительность 37,5 мин
  positions: {
    1: { n: 1000, gpm: 600, xpm: 800, heroes: [hero(1, 300, { gpm: 600, xpm: 800, k: 6, d: 4, a: 8, hd: 20000, lh: 300, m: 40 })] },
    2: { n: 1000, gpm: 580, xpm: 820, heroes: [] },
    4: { n: 500, gpm: 300, xpm: 500, heroes: [hero(5, 100, { gpm: 300, xpm: 500, k: 2, d: 6, a: 12, hd: 10000, lh: 40, m: 40 })] },
    5: { n: 500, gpm: 280, xpm: 450, heroes: [hero(5, 300, { gpm: 260, xpm: 460, k: 2, d: 8, a: 14, hd: 8000, lh: 20, m: 40 })] },
  },
};

// Каталог: все гайды и этапы существуют.
const mods = new Set(COURSES.flatMap(c => c.modules.map(m => `${c.id}/${m.id}`)));
ok(A.checkCatalog(g => guides.has(g), (c, m) => mods.has(`${c}/${m}`)).length === 0, 'каталог рекомендаций: гайды и этапы на месте');

// Эталон.
ok(near(A.baseMinutes(stats), 37.5), 'средняя длительность базы по корзинам: 37,5 мин');
const bs = A.baseline(stats, 5, 'sup');
ok(bs.kind === 'hero' && bs.n === 400 && near(bs.gpm, (300 * 100 + 260 * 300) / 400), 'поддержка: позиции 4 и 5 сливаются по числу матчей');
const bp = A.baseline(stats, 99, 2);
ok(bp.kind === 'position' && bp.gpm === 580 && bp.k === undefined && near(bp.minutes, 37.5), 'нет героя на позиции → среднее по позиции, только GPM/XPM, длительность базы');
ok(A.baseline({ positions: {} }, 1, 1) === null, 'нет позиции в базе → эталона нет');

// Показатели «в минуту»: 40-минутный матч против эталона с m = 40 — те же числа.
const same = { heroId: 1, pos: 1, win: true, duration: 2400, gpm: 600, xpm: 800, k: 6, d: 4, a: 8, lh: 300, hd: 20000 };
const r0 = A.analyze(same, { stats });
ok(r0.ok && r0.metrics.every(m => m.verdict === 'ok' && near(m.ratio, 1)), 'игрок ровно на эталоне → все показатели «около среднего»');
ok(r0.recs.length === 0 && r0.strengths.length === 0 && r0.task === null, 'на эталоне нет ни рекомендаций, ни сильных сторон, ни задания');
// 20-минутный матч с половиной добиваний — тот же темп.
const half = A.analyze(Object.assign({}, same, { duration: 1200, lh: 150, k: 3, d: 2, a: 4, hd: 10000 }), { stats });
ok(half.metrics.filter(m => m.key !== 'gpm' && m.key !== 'xpm').every(m => near(m.ratio, 1)), 'вдвое короче матч и вдвое меньше добиваний/смертей → тот же темп в минуту');

// Пороги.
const low = A.analyze(Object.assign({}, same, { gpm: 600 * 0.84, d: 4 * 1.25, lh: 300 * 0.86 }), { stats });
const M = Object.fromEntries(low.metrics.map(m => [m.key, m]));
ok(M.gpm.verdict === 'low' && M.lh.verdict === 'ok' && M.deaths.verdict === 'low', 'пороги: −16 % — «ниже», −14 % — «около», смерти +25 % — «больше»');
ok(low.recs[0].id === 'deaths' || low.recs[0].id === 'farm', 'рекомендации отсортированы по силе отставания');
ok(low.recs.find(r => r.id === 'farm').stage.course === 'carry', 'позиция 1 → этапы маршрута «Керри»');
ok(/не больше|не меньше/.test(low.task.text), 'задание на матч — измеримая цель на уровне эталона');

// Рекомендация из ответа при нормальном показателе — текстовое задание, а не уже выполненная цифра.
const fromAns = A.analyze(Object.assign({}, same, { gpm: 700, answers: { hard: 'farm' } }), { stats });
ok(fromAns.recs[0].id === 'farm' && !/не меньше|не больше/.test(fromAns.task.text), 'рекомендация из ответа при показателе выше эталона → задание без числовой цели');

// Поддержке не советуют фарм по одним цифрам, но советуют по ответу «тяжело фармить».
const sup = A.analyze({ heroId: 5, pos: 5, win: false, duration: 2400, gpm: 150, xpm: 460, k: 2, d: 8, a: 14, lh: 5, hd: 8000 }, { stats });
ok(!sup.recs.some(r => r.id === 'farm'), 'поддержка: низкий GPM сам по себе не даёт рекомендацию «Фарм»');
const supA = A.analyze({ heroId: 5, pos: 5, win: false, duration: 2400, gpm: 150, xpm: 460, k: 2, d: 8, a: 14, lh: 5, hd: 8000, answers: { hard: 'farm', mood: 'tilt' } }, { stats });
ok(supA.recs.some(r => r.id === 'farm') && supA.recs.some(r => r.id === 'tilt'), 'ответы на вопросы добавляют рекомендации');

// Контекст команды.
const team = [
  { k: 2, d: 9, a: 3, nw: 9000, hd: 9000, td: 100 },
  { k: 10, d: 2, a: 5, nw: 20000, hd: 30000, td: 5000 },
  { k: 5, d: 3, a: 9, nw: 15000, hd: 20000, td: 3000 },
  { k: 1, d: 6, a: 12, nw: 7000, hd: 6000, td: 200 },
  { k: 2, d: 5, a: 14, nw: 6000, hd: 5000, td: 100 },
];
const tm = A.analyze(Object.assign({}, same, { k: 2, d: 9, a: 3, nw: 9000, hd: 9000, td: 100, team }), { stats });
ok(near(tm.team.kp, 5 / 20) && tm.team.kpRank === 5 && tm.team.nwRank === 3 && tm.team.deathRank === 1, 'команда: участие 25 %, 5-е место; ценность 3-я; смертей больше всех');
ok(tm.recs.find(r => r.id === 'fights').why.some(w => /меньше всех в команде/.test(w)), 'низкое участие в убийствах попадает в причины');

// Отказы.
ok(A.analyze(Object.assign({}, same, { duration: 500 }), { stats }).error === 'short', 'матч короче 10 минут не разбирается');
ok(A.analyze(Object.assign({}, same, { gameMode: 23 }), { stats }).error === 'turbo', 'Turbo не разбирается');
ok(A.analyze(Object.assign({}, same, { pos: 7 }), { stats }).error === 'pos', 'неверная позиция — ошибка, не падение');

console.log(fails ? `\nОшибок: ${fails}` : '\nВсе проверки пройдены.');
process.exit(fails ? 1 : 0);
