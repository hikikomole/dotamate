'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('./fetch-names-ru');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'names-ru-'));
const out = path.join(dir, 'names.json');
const fixture = endpoint => endpoint === 'herolist'
  ? { result: { data: { heroes: Array.from({ length: 120 }, (_, id) => ({ id: id + 1, name_loc: id ? `Герой-${id + 1}` : 'Антимаг' })) } } }
  : endpoint === 'itemlist'
    ? { result: { data: { itemabilities: Array.from({ length: 300 }, (_, id) => ({ id: id + 1, name: id ? `item_${id}` : 'item_blink', name_loc: id ? `Предмет-${id}` : 'Блинк' })) } } }
    : { result: { data: { heroes: [{ id: 1, name_loc: 'Антимаг', max_health: 626, abilities: [{ name: 'antimage_blink', name_loc: 'Скачок' }] }] } } };
(async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    const u = new URL(url);
    calls.push(u);
    if (!u.pathname.endsWith('/herodata')) assert.equal(init.headers['Accept-Language'], 'ru-RU,ru;q=0.9');
    return { ok: true, json: async () => fixture(u.pathname.split('/').pop()) };
  };
  const options = { cache: path.join(dir, 'cache.json'), delayMs: 0 };
  await build(fetcher, out, options);
  const result = JSON.parse(fs.readFileSync(out));
  assert.equal(result.heroes['1'], 'Антимаг');
  assert.equal(result.items.blink, 'Блинк');
  assert.equal(result.abilities.antimage_blink, 'Скачок');
  assert(calls.filter(u => !u.pathname.endsWith('/herodata')).every(u => u.search === '?language=russian'), 'Russian language requested for each catalog endpoint');
  assert.equal(calls.filter(u => u.pathname.endsWith('/herodata'))[0].searchParams.get('language'), 'russian');
  calls.length = 0;
  await build(fetcher, out, options);
  assert.equal(calls.length, 2, 'reuse Russian herodata cache');
  const before = fs.readFileSync(out, 'utf8');
  await assert.rejects(build(async () => ({ ok: false, status: 503 }), out, options));
  assert.equal(fs.readFileSync(out, 'utf8'), before, 'HTTP failure keeps previous file');
  const english = async url => {
    const u = new URL(url), d = fixture(u.pathname.split('/').pop());
    for (const h of d.result.data.heroes || []) h.name_loc = 'English hero';
    for (const i of d.result.data.itemabilities || []) i.name_loc = 'English item';
    if (u.pathname.endsWith('/herodata')) d.result.data.heroes[0].abilities[0].name_loc = 'Blink';
    return { ok: true, json: async () => d };
  };
  await build(english, out, { ...options, cache: path.join(dir, 'english.json') });
  const englishResult = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(englishResult.heroes['1'], 'English hero');
  assert.equal(englishResult.items.blink, 'English item');
  assert.equal(englishResult.abilities.antimage_blink, 'Blink');
  const beforeInvalid = fs.readFileSync(out, 'utf8');
  const empty = async url => {
    const u = new URL(url), d = fixture(u.pathname.split('/').pop());
    for (const h of d.result.data.heroes || []) h.name_loc = '   ';
    for (const i of d.result.data.itemabilities || []) i.name_loc = '';
    return { ok: true, json: async () => d };
  };
  await assert.rejects(build(empty, out, options), /catalog too small/);
  assert.equal(fs.readFileSync(out, 'utf8'), beforeInvalid, 'empty names keep previous file');
  await assert.rejects(build(async () => ({ ok: true, json: async () => ({ result: { data: null } }) }), out, options), /catalog too small/);
  assert.equal(fs.readFileSync(out, 'utf8'), beforeInvalid, 'broken catalog keeps previous file');
  const beforeSmallCatalog = fs.readFileSync(out, 'utf8');
  await assert.rejects(build(fetcher, out, { ...options, totalMs: 0 }), /time cap/);
  const tooSmall = async url => {
    const u = new URL(url);
    const data = u.pathname.endsWith('/herolist') ? { heroes: [{ id: 1, name_loc: 'Антимаг' }] } : { items: [{ name: 'item_blink', name_loc: 'Блинк' }] };
    return { ok: true, json: async () => ({ result: { data } }) };
  };
  await assert.rejects(build(tooSmall, out, options), /catalog too small/);
  assert.equal(fs.readFileSync(out, 'utf8'), beforeSmallCatalog, 'small catalog leaves previous file intact');
  const missingAbilities = async url => {
    const data = fixture(new URL(url).pathname.split('/').pop());
    if (new URL(url).pathname.endsWith('/herodata')) data.result.data.heroes[0].abilities = [];
    return { ok: true, json: async () => data };
  };
  const beforeMissingAbilities = fs.readFileSync(out, 'utf8');
  await assert.rejects(build(missingAbilities, out, { ...options, cache: path.join(dir, 'empty.json') }), /missing localized/);
  assert.equal(fs.readFileSync(out, 'utf8'), beforeMissingAbilities);
  console.log('fetch-names-ru: OK');
})().finally(() => fs.rmSync(dir, { recursive: true, force: true })).catch(e => { console.error(e); process.exitCode = 1; });



