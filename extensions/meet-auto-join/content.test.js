const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
const paddingXPath = '/html/body/div[1]/c-wiz/div/div/div[22]/div[3]/div/div[3]/div[4]/div/div/div[2]';

function loadPanel(saved = {}, hasFooter = true, hasPaddingTarget = true) {
  const elements = [];
  const storage = new Map(Object.entries(saved));
  const mutationObservers = [];
  const notifyMutations = () => {
    for (const observer of mutationObservers) {
      if (observer.active) observer.callback();
    }
  };

  function element(tagName) {
    const node = {
      tagName,
      style: {},
      children: [],
      listeners: {},
      attributes: {},
      value: '',
      checked: false,
      appendChild(child) {
        this.children.push(child);
        child.parentNode = this;
      },
      removeChild(child) {
        this.children.splice(this.children.indexOf(child), 1);
        child.parentNode = null;
      },
      addEventListener(type, listener) {
        (this.listeners[type] ||= []).push(listener);
      },
      dispatch(type, event = {}) {
        for (const listener of this.listeners[type] || []) listener(event);
      },
      setAttribute(name, value) { this.attributes[name] = value; },
      getAttribute(name) { return this.attributes[name] || null; },
      contains(target) { return this === target || this.children.some((child) => child.contains(target)); },
      click() { this.dispatch('click'); },
    };
    elements.push(node);
    return node;
  }

  const body = element('body');
  const footer = element('footer');
  let paddingTarget = element('div');
  paddingTarget.style.paddingBottom = '24px';
  let footerTop = 700;
  let onFooterResize;
  footer.getBoundingClientRect = () => ({ top: footerTop });
  const joinButton = element('button');
  joinButton.textContent = 'Join now';
  joinButton.closest = () => joinButton;
  const devices = ['microphone', 'camera'].map((kind) => {
    const button = element('button');
    button.setAttribute('data-is-muted', 'false');
    button.setAttribute('aria-label', 'Turn off ' + kind);
    button.clicks = 0;
    button.click = function () { this.clicks++; };
    return button;
  });
  const document = {
    body,
    listeners: {},
    createElement: element,
    evaluate(xpath) {
      assert.equal(xpath, paddingXPath);
      return { singleNodeValue: hasPaddingTarget ? paddingTarget : null };
    },
    getElementById(id) { return elements.find((node) => node.id === id && node.parentNode) || null; },
    querySelector(selector) { return selector === 'footer' && hasFooter ? footer : null; },
    querySelectorAll(selector) {
      if (selector === 'button, [role="button"]') return [joinButton];
      if (selector === '[data-is-muted][aria-label]') return devices;
      return [];
    },
    addEventListener(type, listener) { this.listeners[type] = listener; },
    removeEventListener(type) { delete this.listeners[type]; },
  };
  let poll;
  const window = {
    innerHeight: 800,
    XPathResult: { FIRST_ORDERED_NODE_TYPE: 9 },
    listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    removeEventListener(type) { delete this.listeners[type]; },
    ResizeObserver: class {
      constructor(callback) { onFooterResize = callback; }
      observe() {}
      disconnect() {}
    },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        mutationObservers.push(this);
      }
      observe() { this.active = true; }
      disconnect() { this.active = false; }
    },
    setInterval(callback) { poll = callback; return 1; },
    clearInterval() {},
    setTimeout() { return 1; },
    clearTimeout() {},
  };
  const localStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, value); },
  };
  vm.runInNewContext(source, { window, document, localStorage, Date, console });
  poll();

  return {
    storage,
    devices,
    manualJoin() { document.listeners.click({ target: joinButton }); },
    get paddingTarget() { return paddingTarget; },
    addPaddingTarget() { hasPaddingTarget = true; notifyMutations(); },
    replacePaddingTarget() {
      const oldTarget = paddingTarget;
      paddingTarget = element('div');
      paddingTarget.style.paddingBottom = '12px';
      hasPaddingTarget = true;
      notifyMutations();
      return oldTarget;
    },
    addFooter() { hasFooter = true; notifyMutations(); },
    moveFooter(top) { footerTop = top; onFooterResize(); },
    resizeViewport(height) { window.innerHeight = height; window.listeners.resize(); },
    panel: elements.find((node) => node.id === 'meet-auto-join-panel'),
    time: elements.find((node) => node.type === 'time'),
    checkboxes: elements.filter((node) => node.type === 'checkbox'),
  };
}

test('minute arrow steps carry across the hour', () => {
  const { time } = loadPanel();
  for (const [before, key, nativeValue, expected] of [
    ['10:59', 'ArrowUp', '10:00', '11:00'],
    ['10:00', 'ArrowDown', '10:59', '09:59'],
    ['23:59', 'ArrowUp', '23:00', '00:00'],
    ['00:00', 'ArrowDown', '00:59', '23:59'],
    ['10:59', 'ArrowUp', '11:00', '11:00'],
    ['10:00', 'ArrowDown', '09:59', '09:59'],
  ]) {
    time.value = before;
    time.dispatch('keydown', { key });
    time.value = nativeValue;
    time.dispatch('input');
    assert.equal(time.value, expected);
  }
});

test('Enter in the time field toggles auto join', () => {
  const { time, checkboxes } = loadPanel();
  const autoJoin = checkboxes[0];
  time.dispatch('keydown', { key: 'Enter', preventDefault() {} });
  assert.equal(autoJoin.checked, true);
  time.dispatch('keydown', { key: 'Enter', preventDefault() {} });
  assert.equal(autoJoin.checked, false);
});

test('the panel stays centered above the footer with separate saved device choices', () => {
  const { panel, checkboxes, storage, devices, moveFooter, resizeViewport } =
    loadPanel({ 'meet-auto-join:av-off': '1' });
  assert.equal(panel.style.left, '50%');
  assert.equal(panel.style.bottom, '112px');
  moveFooter(650);
  assert.equal(panel.style.bottom, '162px');
  resizeViewport(900);
  assert.equal(panel.style.bottom, '262px');
  assert.equal(panel.children.length, 2);
  const [autoJoinRow, devicesRow] = panel.children;
  assert.equal(autoJoinRow.style.display, 'flex');
  assert.equal(autoJoinRow.children[0].children[0], checkboxes[0]);
  assert.equal(autoJoinRow.children[0].children[1].textContent, 'Auto join at');
  assert.equal(autoJoinRow.children[1].type, 'time');
  assert.match(autoJoinRow.children[2].textContent, /Idle/);
  assert.equal(devicesRow.style.display, 'flex');
  assert.equal(devicesRow.children[0].children[0], checkboxes[1]);
  assert.equal(devicesRow.children[1].children[0], checkboxes[2]);
  assert.equal(checkboxes.length, 3);
  assert.equal(checkboxes[1].checked, true);
  assert.equal(checkboxes[2].checked, true);
  assert.deepEqual(devices.map((device) => device.clicks), [1, 1]);
  checkboxes[1].checked = false;
  checkboxes[1].dispatch('change');
  assert.equal(storage.get('meet-auto-join:mic-off'), '0');
  assert.equal(storage.get('meet-auto-join:camera-off'), '1');
});

test('mic and camera choices control their devices separately', () => {
  const { checkboxes, devices } = loadPanel({
    'meet-auto-join:mic-off': '1',
    'meet-auto-join:camera-off': '0',
  });
  assert.deepEqual(devices.map((device) => device.clicks), [1, 0]);
  checkboxes[2].checked = true;
  checkboxes[2].dispatch('change');
  assert.deepEqual(devices.map((device) => device.clicks), [1, 1]);
});

test('the panel moves above a footer that appears after it', () => {
  const { panel, addFooter } = loadPanel({}, false);
  assert.equal(panel.style.bottom, '16px');
  addFooter();
  assert.equal(panel.style.bottom, '112px');
});

test('the specified Meet node receives 80px bottom padding', () => {
  const panel = loadPanel();
  assert.equal(panel.paddingTarget.style.paddingBottom, '80px');
  const oldTarget = panel.replacePaddingTarget();
  assert.equal(oldTarget.style.paddingBottom, '24px');
  assert.equal(panel.paddingTarget.style.paddingBottom, '80px');
  panel.manualJoin();
  assert.equal(panel.paddingTarget.style.paddingBottom, '12px');
});

test('bottom padding is applied when the Meet node appears later', () => {
  const panel = loadPanel({}, true, false);
  assert.equal(panel.paddingTarget.style.paddingBottom, '24px');
  panel.addPaddingTarget();
  assert.equal(panel.paddingTarget.style.paddingBottom, '80px');
});
