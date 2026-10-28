const fs = require('fs');
const path = require('path');

function buildTalentNames() {
  try {
    const ru = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'talents-ru.json'), 'utf8'));
    const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'ability-index.json'), 'utf8')).abilities;
    const tree = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'talent-tree.json'), 'utf8')).heroes;
    const out = {};
    for (const lv of Object.values(tree)) for (const arr of Object.values(lv)) for (const t of arr) {
      const key = idx[t.abilityId] && idx[t.abilityId].name;
      // byAbilityId часто уже с числом («+150 к урону от Meat Hook») — берём его; иначе шаблон byKey.
      const ready = ru.byAbilityId[t.abilityId];
      let s = ready && /[А-Яа-яЁё]/.test(ready) && !/\{s:/.test(ready) ? ready : (key && ru.byKey[key]) || ready;
      if (!s || !/[А-Яа-яЁё]/.test(s)) continue;
      const ph = s.match(/\{s:[A-Za-z0-9_]+\}/g) || [];
      if (ph.length) {
        const n = String(t.title || '').match(/\d+(?:\.\d+)?/g) || [];
        if (n.length !== 1 || new Set(ph).size !== 1) continue;
        s = s.replace(/\{s:[A-Za-z0-9_]+\}/g, n[0]);
      }
      s = s.replace(/(\d)\.(\d)/g, '$1,$2');   // десятичная запятая, как на всём сайте
      if (!/\{s:|%[a-z_]+%/i.test(s)) out[t.abilityId] = s;
    }
    return out;
  } catch { return {}; }
}

module.exports = { buildTalentNames };
