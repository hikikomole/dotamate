const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('js/match.js', 'utf8');
const start = source.indexOf('  let tabClickToken = 0;');
const end = source.indexOf('  function replayApi()', start);
assert(start >= 0 && end > start);
let top = 300;
let scrolls = 0;
let onScroll;
const tabs = { getBoundingClientRect: () => ({ top }) };
const panel = { isConnected: true, style: {}, getBoundingClientRect: () => ({ height: 500 }) };
const context = {
  out: { querySelector: () => tabs }, tallestPanel: 0,
  window: { innerHeight: 900, addEventListener: (_, fn) => { onScroll = fn; }, scrollBy: ({ top: delta }) => { scrolls++; top -= delta; } },
};
vm.createContext(context);
vm.runInContext(source.slice(start, end) + '\nthis.clickAnchor = clickAnchor;', context);
const first = context.clickAnchor(tabs);
top = 250;
context.window.matchTabLayout(panel, first);
assert.equal(top, 300);
top = -317;
onScroll();
context.window.matchTabLayout(panel, first);
assert.equal(top, -317);
const second = context.clickAnchor(tabs);
top = -350;
context.window.matchTabLayout(panel, first);
assert.equal(top, -350);
context.window.matchTabLayout(panel, second);
assert.equal(top, -317);
context.window.matchTabLayout(panel);
assert.equal(scrolls, 2);
console.log('Match tab anchoring: PASS');
