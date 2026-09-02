(function () {
  'use strict';

  // Meet is a SPA and this script may evaluate more than once per document.
  if (window.__meetAutoJoinLoaded) return;
  window.__meetAutoJoinLoaded = true;

  const PANEL_ID = 'meet-auto-join-panel';
  const AV_OFF_KEY = 'meet-auto-join:av-off';

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
  function readAvOff() {
    try {
      return localStorage.getItem(AV_OFF_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function writeAvOff(value) {
    try {
      localStorage.setItem(AV_OFF_KEY, value ? '1' : '0');
    } catch (e) {
      /* private mode, or the site's storage is blocked — preference is lost */
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
  function silenceAv(attemptsLeft) {
    if (!panelEl) return; // the panel was closed while a retry was pending
    let missing = false;
    ['microphone', 'camera'].forEach(function (kind) {
      const button = findAvButton(kind);
      if (!button) {
        missing = true;
        return;
      }
      if (isAvOn(button)) button.click();
    });
    if (missing && attemptsLeft > 0) {
      window.setTimeout(function () { silenceAv(attemptsLeft - 1); }, 1000);
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
      setStatus('Idle. Set a time, then tick Enable auto join.', 'muted');
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
  let avCheckbox = null;
  let statusEl = null;

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
      gap: '8px',
      marginBottom: '8px',
      cursor: 'pointer',
    });
    const box = document.createElement('input');
    box.type = 'checkbox';
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
      bottom: '16px',
      right: '16px',
      zIndex: '2147483647',
      background: '#ffffff',
      border: '1px solid #dadce0',
      borderRadius: '12px',
      boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
      padding: '14px 16px',
      width: '360px',
      font: '16px/1.4 "Google Sans", Roboto, Arial, sans-serif',
      color: '#202124',
      cursor: 'default',
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      fontWeight: '600',
      marginBottom: '10px',
      userSelect: 'none',
    });

    const headerTitle = document.createElement('span');
    headerTitle.textContent = 'Meet Auto Join';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.title = 'Close';
    Object.assign(closeBtn.style, {
      border: 'none',
      background: 'transparent',
      color: '#5f6368',
      cursor: 'pointer',
      fontSize: '20px',
      lineHeight: '1',
      padding: '0 4px',
      borderRadius: '6px',
    });
    closeBtn.addEventListener('mouseenter', function () {
      closeBtn.style.background = '#f1f3f4';
      closeBtn.style.color = '#202124';
    });
    closeBtn.addEventListener('mouseleave', function () {
      closeBtn.style.background = 'transparent';
      closeBtn.style.color = '#5f6368';
    });
    closeBtn.addEventListener('click', teardown);

    header.appendChild(headerTitle);
    header.appendChild(closeBtn);

    const timeLabel = document.createElement('label');
    timeLabel.textContent = 'Join at';
    Object.assign(timeLabel.style, { display: 'block', marginBottom: '4px' });

    timeInput = document.createElement('input');
    timeInput.type = 'time';
    timeInput.value = defaultTimeValue();
    Object.assign(timeInput.style, {
      width: '100%',
      boxSizing: 'border-box',
      padding: '6px 8px',
      border: '1px solid #dadce0',
      borderRadius: '8px',
      marginBottom: '10px',
      font: 'inherit',
    });

    const enable = makeCheckbox('Enable auto join');
    enableCheckbox = enable.box;

    const av = makeCheckbox('Turn mic and camera off');
    avCheckbox = av.box;
    avCheckbox.checked = readAvOff();

    statusEl = document.createElement('div');
    Object.assign(statusEl.style, {
      fontSize: '14px',
      color: '#5f6368',
      minHeight: '16px',
    });

    panel.appendChild(header);
    panel.appendChild(timeLabel);
    panel.appendChild(timeInput);
    panel.appendChild(enable.wrap);
    panel.appendChild(av.wrap);
    panel.appendChild(statusEl);
    document.body.appendChild(panel);

    timeInput.addEventListener('input', applyState);
    timeInput.addEventListener('change', applyState);
    // Enter in the time field means "that's my answer", so it arms as well.
    timeInput.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      enableCheckbox.checked = true;
      applyState();
    });
    enableCheckbox.addEventListener('change', applyState);
    avCheckbox.addEventListener('change', function () {
      writeAvOff(avCheckbox.checked);
      if (avCheckbox.checked) silenceAv(AV_RETRIES);
    });

    watchManualJoin();
    if (avCheckbox.checked) silenceAv(AV_RETRIES);
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
    if (manualJoinHandler) {
      document.removeEventListener('click', manualJoinHandler, true);
      manualJoinHandler = null;
    }
    if (panelEl && panelEl.parentNode) panelEl.parentNode.removeChild(panelEl);
    panelEl = null;
    timeInput = null;
    enableCheckbox = null;
    avCheckbox = null;
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
