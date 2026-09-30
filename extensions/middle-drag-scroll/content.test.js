const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');

function element({ height = 100, scrollHeight = 200, scrollTop = 0, overflowY = 'auto' } = {}) {
  return {
    nodeType: 1,
    clientHeight: height,
    scrollHeight,
    scrollTop,
    overflowY,
  };
}

function setup(root = element()) {
  const listeners = new Map();
  const window = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };
  const document = { scrollingElement: root };
  vm.runInNewContext(script, {
    window,
    document,
    getComputedStyle: node => ({ overflowY: node.overflowY }),
    setTimeout: () => 1,
  });

  function send(type, options = {}) {
    const event = {
      button: 1,
      buttons: type === 'mouseup' || type === 'auxclick' ? 0 : 4,
      clientX: 0,
      clientY: 0,
      defaultPrevented: false,
      stopped: false,
      composedPath: () => [root],
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.stopped = true; },
      ...options,
    };
    listeners.get(type)(event);
    return event;
  }

  return { root, send };
}

test('a short middle click keeps its normal auxclick action', () => {
  const { root, send } = setup();
  assert.equal(send('mousedown').defaultPrevented, true);
  send('mousemove', { clientY: 4 });
  send('mouseup', { clientY: 4 });

  assert.equal(root.scrollTop, 0);
  assert.equal(send('auxclick').defaultPrevented, false);
});

test('horizontal movement alone keeps the middle click action', () => {
  const { root, send } = setup();
  send('mousedown');
  send('mousemove', { clientX: 30 });
  send('mouseup', { clientX: 30 });

  assert.equal(root.scrollTop, 0);
  assert.equal(send('auxclick').defaultPrevented, false);
});

test('a drag scrolls with scrollbar-thumb scaling and cancels auxclick', () => {
  const { root, send } = setup(element({ height: 100, scrollHeight: 200, scrollTop: 20 }));
  send('mousedown', { clientY: 10 });
  assert.equal(send('mousemove', { clientY: 20 }).defaultPrevented, true);
  assert.equal(root.scrollTop, 40);
  send('mousemove', { clientY: 5 });
  assert.equal(root.scrollTop, 10);
  send('mouseup');

  const click = send('auxclick');
  assert.equal(click.defaultPrevented, true);
  assert.equal(click.stopped, true);
});

test('the nearest scrollable ancestor receives the drag', () => {
  const root = element({ scrollTop: 30 });
  const panel = element({ scrollTop: 10 });
  const fixedChild = element({ scrollHeight: 100 });
  const { send } = setup(root);
  send('mousedown', { composedPath: () => [fixedChild, panel, root] });
  send('mousemove', { clientY: 10 });

  assert.equal(panel.scrollTop, 30);
  assert.equal(root.scrollTop, 30);
});

test('a non-scrollable area falls back to the page', () => {
  const root = element();
  const child = element({ scrollHeight: 100 });
  const { send } = setup(root);
  send('mousedown', { composedPath: () => [child] });
  send('mousemove', { clientY: 10 });
  assert.equal(root.scrollTop, 20);
});

test('pages with no vertical scroll leave middle clicks alone', () => {
  const { send } = setup(element({ scrollHeight: 100 }));
  assert.equal(send('mousedown').defaultPrevented, false);
  assert.equal(send('auxclick').defaultPrevented, false);
});

test('a missing middle button or a window blur ends the drag', () => {
  const { root, send } = setup();
  send('mousedown');
  send('mousemove', { buttons: 0, clientY: 10 });
  send('mousemove', { clientY: 20 });
  assert.equal(root.scrollTop, 0);

  send('mousedown');
  send('blur');
  send('mousemove', { clientY: 20 });
  assert.equal(root.scrollTop, 0);
});
