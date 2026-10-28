const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

class Node {
  constructor(tag) { this.tag = tag; this.childNodes = []; this.isConnected = true; this.attributes = {}; this.classList = { add() {} }; this.style = { setProperty() {} }; }
  append(...nodes) { this.childNodes.push(...nodes); }
  prepend(node) { this.childNodes.unshift(node); }
  replaceChildren(...nodes) { this.childNodes = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, fn) { (this.handlers ||= {})[key] = fn; }
  set textContent(value) { this.childNodes = []; this.text = value; }
  get textContent() { return this.text || this.childNodes.map(n => n.textContent || '').join(''); }
}
const document = { createElement: tag => new Node(tag), createElementNS: (_, tag) => new Node(tag) };
const window = {};
const { buildTalentNames } = require('../tools/talent-text');
const tree = require('../data/talent-tree.json').heroes['42'];
const index = require('../data/ability-index.json').abilities;
const heroLabels = buildTalentNames();
const wk = Object.values(tree).flat();
const expected = Object.fromEntries(wk.map(t => [index[t.abilityId]?.name, heroLabels[t.abilityId]]).filter(([key, label]) => key && label));
assert.strictEqual(expected.special_bonus_unique_wraith_king_facet_1, '+2 сек. замедления от Wraithfire Blast');
assert.strictEqual(expected.special_bonus_hp_300, '+300 к здоровью');
const fixture = JSON.parse(fs.readFileSync('tests/fixtures/replay-real-shape.json', 'utf8'));
const source = fs.readFileSync('js/match-replay.js', 'utf8').replace('window.matchReplay =', 'window.renderers = { graphs, purchases, skills, events, lanes, damage, wards }; window.matchReplay =');
vm.runInNewContext(source, { document, window, fetch: async url => ({ json: async () => url.includes('talents-text') ? { byKey: expected } : { items: {} } }), URL, location: { origin: 'https://example.test' }, setInterval, clearInterval });
const { graphs, purchases, skills, events, lanes, damage, wards } = window.renderers;
const walk = (node, tag) => (node.tag === tag ? 1 : 0) + node.childNodes.reduce((sum, child) => sum + walk(child, tag), 0);
(async () => {
  const panel = new Node('section');
  graphs(fixture, panel); assert(walk(panel, 'svg') >= 2); panel.childNodes.find(n => n.tag === 'button').handlers.click(); assert(walk(panel, 'svg') >= 3); console.log('Графики: PASS');
  await purchases(fixture, panel, { data: fixture }); assert(walk(panel, 'div') >= 10); console.log('Покупки: PASS');
  panel.replaceChildren(); events(fixture, panel, {}); assert(walk(panel, 'li') >= 3); console.log('События: PASS');
  assert(panel.textContent.includes('Аегис') && panel.textContent.includes('Смок'));
  panel.replaceChildren(); damage(fixture, panel); assert(walk(panel, 'table') === 2); console.log('Урон: PASS');
  const talentFixture = { ...fixture, players: fixture.players.map((p, i) => i ? p : { ...p, skills: [...p.skills, [100, 'special_bonus_unique_wraith_king_facet_1', 1], [101, 'special_bonus_hp_300', 1]] }) };
  panel.replaceChildren(); skills(talentFixture, panel, { data: talentFixture }); await new Promise(resolve => setTimeout(resolve, 0)); assert(walk(panel, 'img') >= 10); assert(!panel.textContent.includes('{s:')); const chips = panel.childNodes.flatMap(row => row.childNodes).flatMap(list => list.childNodes).filter(node => node.tag === 'span' && node.childNodes.some(child => child.tag === 'span')); const labels = chips.flatMap(chip => chip.childNodes.filter(child => child.tag === 'span').map(child => child.textContent)); for (const key of ['special_bonus_unique_wraith_king_facet_1', 'special_bonus_hp_300']) assert(labels.includes(expected[key])); assert(labels.includes('+2 сек. замедления от Wraithfire Blast')); assert(labels.includes('+300 к здоровью')); console.log('Способности: PASS');
  panel.replaceChildren(); lanes(fixture, panel); assert(walk(panel, 'tr') === 11); console.log('Линии: PASS');
  panel.replaceChildren(); wards(fixture, panel); assert(walk(panel, 'circle') >= 1); assert(walk(panel.childNodes[0], 'button') === 3); panel.childNodes[0].childNodes[2].handlers.click(); assert(walk(panel.childNodes[0], 'button') === 3); assert(walk(panel, 'rect') >= 1); console.log('Варды: PASS');
  panel.replaceChildren(); wards(fixture, panel, { mapLayer: 'heat' }); assert(walk(panel, 'rect') >= 1); console.log('Карта: PASS');
  for (const key of ['adv', 'players', 'deaths', 'roshan', 'buildings', 'wards']) {
    const missing = { ...fixture, [key]: undefined }; panel.replaceChildren(); graphs(missing, panel); await purchases(missing, panel, { data: missing }); panel.replaceChildren(); events(missing, panel, {}); panel.replaceChildren(); lanes(missing, panel); panel.replaceChildren(); wards(missing, panel);
  }
  console.log('Отсутствующие массивы: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
