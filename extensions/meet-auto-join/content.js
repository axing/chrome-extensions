(function () {
  'use strict';

  // Meet is a SPA and this script may evaluate more than once per document.
  if (window.__meetAutoJoinLoaded) return;
  window.__meetAutoJoinLoaded = true;

  const PANEL_ID = 'meet-auto-join-panel';
  const AV_OFF_KEY = 'meet-auto-join:av-off';
  const MIC_OFF_KEY = 'meet-auto-join:mic-off';
  const CAMERA_OFF_KEY = 'meet-auto-join:camera-off';
  const BOTTOM_PADDING_XPATH = '/html/body/div[1]/c-wiz/div/div/div[22]/div[3]/div/div[3]/div[4]/div/div/div[2]';

  // Fire the join this far before the target. Chrome wakes a long-hidden page
  // once a minute, aligned to the whole minute, and targets are always whole
  // minutes, so the aligned wake-up lands on the target. The tolerance absorbs
  // the millisecond either side of that boundary. See "Traps" in the README.
  const JOIN_TOLERANCE_MS = 1000;
  const JOIN_WINDOW_MS = 30000;   // keep retrying the click for this long
  const PRECALL_POLL_MS = 300;
  const PRECALL_TIMEOUT_MS = 20000;
  const AV_RETRIES = 5;           // Meet renders the mic/cam buttons lazily

  // ---- State ---------------------------------------------------------------
  let armedTarget = null;   // Date we are counting down to, or null
  let ticker = null;        // countdown + "is it time yet?" tick
  let retryTicker = null;   // post-fire join retries

  // ---- Accurate interval ---------------------------------------------------
  // A repeating tick that re-aims itself at the next wall-clock boundary. Used
  // instead of one long setTimeout because a tick comparing against the clock
  // cannot overshoot its moment, while a one-shot timer can be rounded past it.
  function setAccurateInterval(callback, interval) {
    let timeoutId = null;
    let running = true;
    let expected = Date.now() + interval;

    function tick() {
      if (!running) return;
      callback();
      if (!running) return;
      const drift = Date.now() - expected;
      expected += interval;
      timeoutId = window.setTimeout(tick, Math.max(0, interval - drift));
    }

    timeoutId = window.setTimeout(tick, interval);

    return {
      stop: function () {
        running = false;
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        timeoutId = null;
      },
    };
  }

  // ---- Time helpers --------------------------------------------------------
  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  // Default value for the time field: one minute from now. Built by adding to
  // the epoch, so 09:59 becomes 10:00 and 23:59 becomes 00:00 rather than the
  // impossible "09:60" that string arithmetic produces.
  function defaultTimeValue() {
    const d = new Date(Date.now() + 60000);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  // "HH:MM" resolved against today. A time already past is left in the past
  // rather than rolled to tomorrow: only a future time is valid.
  function timeStringToDate(hhmm) {
    if (!hhmm) return null;
    const parts = hhmm.split(':');
    if (parts.length < 2) return null;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    const target = new Date();
    target.setHours(h, m, 0, 0);
    return target;
  }

  function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // mm:ss, or h:mm:ss over an hour.
  function formatDelay(ms) {
    const totalSec = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return h + ':' + pad2(m) + ':' + pad2(s);
    return m + ':' + pad2(s);
  }

  // ---- Saved preference ----------------------------------------------------
  // localStorage belongs to meet.google.com, which this script shares. Nothing
  // secret goes in it, so the page owning it does not matter, and it keeps the
  // manifest free of a storage permission.
  function readDeviceOff(key) {
    try {
      const saved = localStorage.getItem(key);
      return (saved === null ? localStorage.getItem(AV_OFF_KEY) : saved) === '1';
    } catch (e) {
      return false;
    }
  }

  function writeDevicePrefs() {
    try {
      localStorage.setItem(MIC_OFF_KEY, micCheckbox.checked ? '1' : '0');
      localStorage.setItem(CAMERA_OFF_KEY, cameraCheckbox.checked ? '1' : '0');
    } catch (e) {
      /* Private mode or blocked site storage prevents saving the preference. */
    }
  }

  // ---- Meet's controls -----------------------------------------------------
  // The join control has no stable id, so it is matched by visible label. It is
  // "Join now" when you are let straight in, "Ask to join" when a host must
  // admit you, and "Join anyway" when you open the room well before the start.
  const JOIN_LABELS = [
    'join now',
    'ask to join',
    'join meeting',
    'switch here',
    'join anyway',
  ];

  function joinLabelMatch(node, exact) {
    const text = (node.textContent || '').trim().toLowerCase();
    return JOIN_LABELS.some(function (label) {
      return exact ? text === label : text.indexOf(label) !== -1;
    });
  }

  // Exact label first. A loose match can land on an outer wrapper whose text
  // happens to contain the button's, which is not the thing you want to click.
  function findJoinButton() {
    const buttons = Array.from(
      document.querySelectorAll('button, [role="button"]')
    );
    return (
      buttons.find(function (b) { return joinLabelMatch(b, true); }) ||
      buttons.find(function (b) { return joinLabelMatch(b, false); }) ||
      null
    );
  }

  // "Leave call" only exists once you are in the meeting. Its presence means
  // there is no pre-call screen to auto-join.
  function isInCall() {
    return !!document.querySelector(
      '[aria-label*="Leave call" i], button[jsname][data-tooltip*="Leave call" i]'
    );
  }

  // Meet's mic and camera toggles carry data-is-muted. Requiring "turn on/off"
  // in the label keeps settings buttons that merely mention the device out.
  function findAvButton(kind) {
    const muted = Array.from(document.querySelectorAll('[data-is-muted][aria-label]'));
    const pool = muted.length
      ? muted
      : Array.from(document.querySelectorAll('[aria-label][role="button"], button[aria-label]'));
    return (
      pool.find(function (node) {
        const label = (node.getAttribute('aria-label') || '').toLowerCase();
        return label.indexOf(kind) !== -1 && /turn (on|off)/.test(label);
      }) || null
    );
  }

  function isAvOn(button) {
    const muted = button.getAttribute('data-is-muted');
    if (muted === 'true') return false;
    if (muted === 'false') return true;
    // No attribute: the label names the action, so "Turn off …" means it is on.
    return /^turn off/.test((button.getAttribute('aria-label') || '').toLowerCase());
  }

  // Read the real state and click only what is actually on. Another extension
  // may already have muted these; a blind click would switch them back on.
  function silenceDevice(kind, attemptsLeft) {
    const checkbox = kind === 'microphone' ? micCheckbox : cameraCheckbox;
    if (!panelEl || !checkbox.checked) return;
    const button = findAvButton(kind);
    if (button) {
      if (isAvOn(button)) button.click();
    } else if (attemptsLeft > 0) {
      window.setTimeout(function () { silenceDevice(kind, attemptsLeft - 1); }, 1000);
    }
  }

  // ---- Joining -------------------------------------------------------------
  function attemptJoin() {
    const button = findJoinButton();
    if (!button) {
      setStatus('Join button not found yet, retrying…', 'warn');
      return false;
    }
    button.click();
    teardown();
    return true;
  }

  // At the scheduled moment the button may not be there yet (permission
  // prompts, slow render). Retry against a wall-clock deadline rather than an
  // attempt count, because a throttled tab ticks far slower than once a second.
  function joinWithRetries() {
    if (attemptJoin()) return;
    const deadline = Date.now() + JOIN_WINDOW_MS;
    retryTicker = setAccurateInterval(function () {
      if (attemptJoin() || Date.now() > deadline) stopRetries();
    }, 1000);
  }

  function stopRetries() {
    if (retryTicker) {
      retryTicker.stop();
      retryTicker = null;
    }
  }

  // ---- Scheduling ----------------------------------------------------------
  function disarm() {
    armedTarget = null;
    if (ticker) {
      ticker.stop();
      ticker = null;
    }
  }

  function arm(target) {
    armedTarget = target;
    if (!ticker) ticker = setAccurateInterval(onTick, 1000);
    renderCountdown();
  }

  function renderCountdown() {
    if (!armedTarget) return;
    setStatus(
      'Auto join armed for ' + formatTime(armedTarget) +
        ' (in ' + formatDelay(armedTarget.getTime() - Date.now()) + ').',
      'ok'
    );
  }

  function onTick() {
    if (!armedTarget) {
      disarm();
      return;
    }
    if (armedTarget.getTime() - Date.now() <= JOIN_TOLERANCE_MS) {
      disarm();
      setStatus('Time reached — joining…', 'ok');
      joinWithRetries();
      return;
    }
    renderCountdown();
  }

  // Source of truth for what the panel should be doing right now.
  function applyState() {
    if (!enableCheckbox.checked) {
      disarm();
      setStatus('Idle. Set a time, then enable auto join.', 'muted');
      return;
    }

    const target = timeStringToDate(timeInput.value);
    if (!target) {
      disarm();
      setStatus('Enter a time to enable auto join.', 'warn');
      return;
    }

    // The default value is set once and never refreshed, so it goes stale if
    // the panel sits untouched. Say so instead of guessing a new time.
    if (target.getTime() <= Date.now()) {
      disarm();
      setStatus('That time has already passed. Pick a future time.', 'warn');
      return;
    }

    arm(target);
  }

  // ---- UI ------------------------------------------------------------------
  let panelEl = null;
  let timeInput = null;
  let enableCheckbox = null;
  let micCheckbox = null;
  let cameraCheckbox = null;
  let statusEl = null;
  let footerResizeObserver = null;
  let footerArrivalObserver = null;
  let paddingObserver = null;
  let paddedElement = null;
  let originalPaddingBottom = '';

  function updateBottomPadding() {
    const element = document.evaluate(
      BOTTOM_PADDING_XPATH,
      document,
      null,
      window.XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue;
    if (element === paddedElement) return;
    if (paddedElement) paddedElement.style.paddingBottom = originalPaddingBottom;
    paddedElement = element;
    if (element) {
      originalPaddingBottom = element.style.paddingBottom;
      element.style.paddingBottom = '80px';
    }
    positionPanel();
  }

  function positionPanel() {
    if (!panelEl) return;
    const footer = document.querySelector('footer');
    const footerOffset = footer ? window.innerHeight - footer.getBoundingClientRect().top : 0;
    panelEl.style.bottom = Math.max(16, footerOffset + 12) + 'px';
  }

  function observeFooter() {
    const footer = document.querySelector('footer');
    if (footer) {
      footerResizeObserver = new window.ResizeObserver(positionPanel);
      footerResizeObserver.observe(footer);
      positionPanel();
      return;
    }
    footerArrivalObserver = new window.MutationObserver(function () {
      if (!document.querySelector('footer')) return;
      footerArrivalObserver.disconnect();
      footerArrivalObserver = null;
      observeFooter();
    });
    footerArrivalObserver.observe(document.body, { childList: true, subtree: true });
    positionPanel();
  }

  function setStatus(message, kind) {
    if (!statusEl) return;
    statusEl.textContent = message;
    const colors = { ok: '#1e8e3e', warn: '#b06000', muted: '#5f6368' };
    statusEl.style.color = colors[kind] || colors.muted;
  }

  function makeCheckbox(labelText) {
    const wrap = document.createElement('label');
    Object.assign(wrap.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    });
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.style.margin = '0';
    const text = document.createElement('span');
    text.textContent = labelText;
    wrap.appendChild(box);
    wrap.appendChild(text);
    return { wrap: wrap, box: box };
  }

  function buildPanel() {
    const panel = document.createElement('div');
    panelEl = panel;
    panel.id = PANEL_ID;
    Object.assign(panel.style, {
      position: 'fixed',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '2147483647',
      background: 'rgb(231 238 247 / 70%)',
      borderRadius: '12px',
      border: '1px solid #e3eaf2',
      padding: '10px 16px',
      width: 'min(450px, calc(100vw - 16px))',
      boxSizing: 'border-box',
      font: '13px/1.4 "Google Sans", Roboto, Arial, sans-serif',
      color: '#202124',
      cursor: 'default',
    });

    timeInput = document.createElement('input');
    timeInput.type = 'time';
    timeInput.setAttribute('aria-label', 'Auto join time');
    timeInput.value = defaultTimeValue();
    Object.assign(timeInput.style, {
      width: '80px',
      boxSizing: 'border-box',
      padding: '2px 4px',
      border: '1px solid #dadce0',
      borderRadius: '6px',
      font: 'inherit',
    });

    const enable = makeCheckbox('Auto join at');
    enableCheckbox = enable.box;

    const mic = makeCheckbox('Turn mic off');
    micCheckbox = mic.box;
    micCheckbox.checked = readDeviceOff(MIC_OFF_KEY);

    const camera = makeCheckbox('Turn camera off');
    cameraCheckbox = camera.box;
    cameraCheckbox.checked = readDeviceOff(CAMERA_OFF_KEY);

    statusEl = document.createElement('div');
    Object.assign(statusEl.style, {
      fontSize: '12px',
      color: '#5f6368',
      flex: '1 1 180px',
      minWidth: '0',
    });

    const autoJoinRow = document.createElement('div');
    Object.assign(autoJoinRow.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      flexWrap: 'wrap',
    });
    autoJoinRow.appendChild(enable.wrap);
    autoJoinRow.appendChild(timeInput);
    autoJoinRow.appendChild(statusEl);

    const devicesRow = document.createElement('div');
    Object.assign(devicesRow.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '18px',
      marginTop: '6px',
      flexWrap: 'wrap',
    });
    devicesRow.appendChild(mic.wrap);
    devicesRow.appendChild(camera.wrap);

    panel.appendChild(autoJoinRow);
    panel.appendChild(devicesRow);
    document.body.appendChild(panel);
    window.addEventListener('resize', positionPanel);
    observeFooter();
    updateBottomPadding();
    paddingObserver = new window.MutationObserver(updateBottomPadding);
    paddingObserver.observe(document.body, { childList: true, subtree: true });

    let arrowStep = null;
    let lastWheelStep = -Infinity;
    timeInput.addEventListener('wheel', function (event) {
      event.preventDefault();
      if (!timeInput.value || event.deltaY === 0) return;
      const now = Date.now();
      if (now - lastWheelStep < 250) return;

      const [hours, minutes] = timeInput.value.split(':').map(Number);
      const step = event.deltaY < 0 ? 1 : -1;
      const totalMinutes = (hours * 60 + minutes + step + 1440) % 1440;
      timeInput.value = pad2(Math.floor(totalMinutes / 60)) + ':' + pad2(totalMinutes % 60);
      lastWheelStep = now;
      applyState();
    }, { passive: false });
    timeInput.addEventListener('input', function () {
      if (arrowStep) {
        const before = arrowStep.value.split(':').map(Number);
        const after = timeInput.value.split(':').map(Number);
        const wrapsUp = arrowStep.key === 'ArrowUp' && before[1] === 59 && after[1] === 0;
        const wrapsDown = arrowStep.key === 'ArrowDown' && before[1] === 0 && after[1] === 59;
        if (before[0] === after[0] && (wrapsUp || wrapsDown)) {
          const hour = (after[0] + (wrapsUp ? 1 : 23)) % 24;
          timeInput.value = pad2(hour) + ':' + pad2(after[1]);
        }
        arrowStep = null;
      }
      applyState();
    });
    timeInput.addEventListener('change', applyState);
    timeInput.addEventListener('dblclick', function () {
      enableCheckbox.checked = true;
      applyState();
    });
    timeInput.addEventListener('keydown', function (event) {
      arrowStep = event.key === 'ArrowUp' || event.key === 'ArrowDown'
        ? { key: event.key, value: timeInput.value }
        : null;
      if (event.key === 'Enter') {
        event.preventDefault();
        enableCheckbox.checked = !enableCheckbox.checked;
        applyState();
      }
    });
    enableCheckbox.addEventListener('change', applyState);
    micCheckbox.addEventListener('change', function () {
      writeDevicePrefs();
      if (micCheckbox.checked) silenceDevice('microphone', AV_RETRIES);
    });
    cameraCheckbox.addEventListener('change', function () {
      writeDevicePrefs();
      if (cameraCheckbox.checked) silenceDevice('camera', AV_RETRIES);
    });

    watchManualJoin();
    if (micCheckbox.checked) silenceDevice('microphone', AV_RETRIES);
    if (cameraCheckbox.checked) silenceDevice('camera', AV_RETRIES);
    applyState();
  }

  // A manual join means the panel has done its job, so it goes away. The
  // listener is on the document in the capture phase, because Meet handles the
  // click itself and the event never reaches us otherwise.
  let manualJoinHandler = null;

  function watchManualJoin() {
    manualJoinHandler = function (event) {
      const target = event.target;
      if (!target || typeof target.closest !== 'function') return;
      if (panelEl && panelEl.contains(target)) return;
      const clickable = target.closest('button, [role="button"]');
      if (clickable && joinLabelMatch(clickable, false)) teardown();
    };
    document.addEventListener('click', manualJoinHandler, true);
  }

  function teardown() {
    disarm();
    stopRetries();
    window.removeEventListener('resize', positionPanel);
    if (footerResizeObserver) {
      footerResizeObserver.disconnect();
      footerResizeObserver = null;
    }
    if (footerArrivalObserver) {
      footerArrivalObserver.disconnect();
      footerArrivalObserver = null;
    }
    if (paddingObserver) {
      paddingObserver.disconnect();
      paddingObserver = null;
    }
    if (paddedElement) {
      paddedElement.style.paddingBottom = originalPaddingBottom;
      paddedElement = null;
    }
    if (manualJoinHandler) {
      document.removeEventListener('click', manualJoinHandler, true);
      manualJoinHandler = null;
    }
    if (panelEl && panelEl.parentNode) panelEl.parentNode.removeChild(panelEl);
    panelEl = null;
    timeInput = null;
    enableCheckbox = null;
    micCheckbox = null;
    cameraCheckbox = null;
    statusEl = null;
  }

  // ---- Start-up ------------------------------------------------------------
  // Meet renders asynchronously. Wait for the pre-call screen, and show nothing
  // if we are already in the call.
  function waitForPreCall() {
    const started = Date.now();
    const poll = window.setInterval(function () {
      if (document.getElementById(PANEL_ID) || isInCall()) {
        window.clearInterval(poll);
        return;
      }
      if (findJoinButton()) {
        window.clearInterval(poll);
        buildPanel();
        return;
      }
      if (Date.now() - started > PRECALL_TIMEOUT_MS) window.clearInterval(poll);
    }, PRECALL_POLL_MS);
  }

  function init() {
    if (!document.body) {
      window.setTimeout(init, 200);
      return;
    }
    if (document.getElementById(PANEL_ID)) return;
    waitForPreCall();
  }

  init();
})();
