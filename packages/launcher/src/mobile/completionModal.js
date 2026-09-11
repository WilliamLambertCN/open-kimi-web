{
  const mobile = window.matchMedia('(max-width: 640px)');
  const NativeWebSocket = window.WebSocket;
  const SETTLE_DELAY_MS = 120;
  const runningSelector = '.app .composer .stop, .app.mobile .topbar .st .ui-spinner';
  const pendingSelector = '.dock-approval, .dock-question';
  const sessionRoute = () => {
    const match = location.pathname.match(/^\/sessions\/([^/?#]+)/);
    if (!match) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return null;
    }
  };
  let route = sessionRoute();
  let observedRunning = false;
  let wasRunning = false;
  let waitingForResume = false;
  let modal = null;
  let previousFocus = null;
  let settleTimer = null;
  let readySocketCount = 0;

  const closeModal = () => {
    if (!modal) return;
    modal.remove();
    modal = null;
    document.documentElement.classList.remove('okw-completion-modal-open');
    if (previousFocus?.isConnected) previousFocus.focus();
    previousFocus = null;
  };

  const resetObservation = () => {
    observedRunning = false;
    wasRunning = false;
    waitingForResume = false;
  };

  const syncRoute = () => {
    const nextRoute = sessionRoute();
    if (nextRoute === route) return false;
    route = nextRoute;
    resetObservation();
    closeModal();
    return true;
  };

  const keepFocusInside = (event, dialog) => {
    if (event.key !== 'Tab') return;
    const controls = Array.from(dialog.querySelectorAll('button:not(:disabled)'));
    if (controls.length === 0) return;
    const current = controls.indexOf(document.activeElement);
    const next = event.shiftKey
      ? controls[(current <= 0 ? controls.length : current) - 1]
      : controls[(current + 1) % controls.length];
    event.preventDefault();
    next.focus();
  };

  const showModal = () => {
    if (modal || !mobile.matches || route === null) return;
    previousFocus = document.activeElement;

    const backdrop = document.createElement('div');
    backdrop.className = 'okw-completion-modal-backdrop';
    const dialog = document.createElement('section');
    dialog.className = 'okw-completion-modal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'okw-completion-modal-title');
    dialog.setAttribute('aria-describedby', 'okw-completion-modal-description');

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'okw-completion-modal-close';
    close.setAttribute('aria-label', '关闭');
    close.textContent = '×';

    const title = document.createElement('h2');
    title.id = 'okw-completion-modal-title';
    title.textContent = '任务已完成';
    const description = document.createElement('p');
    description.id = 'okw-completion-modal-description';
    description.textContent = '当前任务已经完成，可以查看结果。';
    const viewResult = document.createElement('button');
    viewResult.type = 'button';
    viewResult.className = 'okw-completion-modal-result';
    viewResult.textContent = '查看结果';

    close.addEventListener('click', closeModal);
    viewResult.addEventListener('click', closeModal);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) closeModal();
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeModal();
      else keepFocusInside(event, dialog);
    });

    dialog.append(close, title, description, viewResult);
    backdrop.append(dialog);
    document.body.append(backdrop);
    document.documentElement.classList.add('okw-completion-modal-open');
    modal = backdrop;
    viewResult.focus();
  };

  const evaluate = () => {
    settleTimer = null;
    syncRoute();
    if (!mobile.matches) {
      resetObservation();
      closeModal();
      return;
    }
    if (readySocketCount === 0) return;

    const running = document.querySelector(runningSelector) !== null;
    const pendingInteraction = document.querySelector(pendingSelector) !== null;
    if (running) {
      observedRunning = true;
      wasRunning = true;
      waitingForResume = false;
      return;
    }
    if (pendingInteraction) {
      if (observedRunning) waitingForResume = true;
      wasRunning = false;
      return;
    }
    if (waitingForResume) return;
    if (!observedRunning || !wasRunning) return;

    resetObservation();
    showModal();
  };

  const scheduleEvaluation = () => {
    if (settleTimer !== null) window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(evaluate, SETTLE_DELAY_MS);
  };

  const parseFrame = (data) => {
    if (typeof data !== 'string') return null;
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  };

  const observeSocket = (socket) => {
    const state = { helloId: null, ready: false };
    const nativeSend = socket.send;
    socket.send = function observedSend(data) {
      const frame = parseFrame(data);
      if (frame?.type === 'client_hello' && typeof frame.id === 'string') {
        if (state.ready) readySocketCount = Math.max(0, readySocketCount - 1);
        state.helloId = frame.id;
        state.ready = false;
      }
      return nativeSend.apply(this, arguments);
    };
    socket.addEventListener('message', (event) => {
      const frame = parseFrame(event.data);
      if (frame?.type !== 'ack' || frame.id !== state.helloId || frame.code !== 0 || state.ready) return;
      state.ready = true;
      readySocketCount += 1;
      scheduleEvaluation();
    });
    socket.addEventListener('close', () => {
      if (state.ready) readySocketCount = Math.max(0, readySocketCount - 1);
      state.ready = false;
    });
  };

  if (typeof NativeWebSocket === 'function') {
    function ObservedWebSocket() {
      const socket = Reflect.construct(NativeWebSocket, Array.from(arguments));
      observeSocket(socket);
      return socket;
    }
    Object.setPrototypeOf(ObservedWebSocket, NativeWebSocket);
    ObservedWebSocket.prototype = NativeWebSocket.prototype;
    window.WebSocket = ObservedWebSocket;
  }

  new MutationObserver(scheduleEvaluation).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  window.addEventListener('popstate', scheduleEvaluation);
  window.addEventListener('hashchange', scheduleEvaluation);
  mobile.addEventListener('change', scheduleEvaluation);
  scheduleEvaluation();
}
