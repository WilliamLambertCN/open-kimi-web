const BATCH_BYTES = 16 * 1024;

function takeBatch(state) {
  const lines = [];
  let bytes = 0;
  while (state.queue.length) {
    const next = state.queue[0];
    if (bytes && bytes + next.length > BATCH_BYTES) break;
    if (state.size + bytes + next.length > state.maxBytes) break;
    lines.push(state.queue.shift());
    bytes += next.length;
  }
  return Buffer.concat(lines, bytes);
}

async function releaseHandle(state) {
  const handle = state.handle;
  state.handle = undefined;
  if (handle) await handle.close();
}

async function rotate(state) {
  await releaseHandle(state);
  if (state.stopped) return;
  await state.fs.rm(`${state.file}.2`, { force: true });
  try {
    await state.fs.rename(`${state.file}.1`, `${state.file}.2`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (state.stopped) return;
  await state.fs.rename(state.file, `${state.file}.1`);
  if (state.stopped) return;
  const handle = await state.fs.open(state.file, 'wx', 0o600);
  if (state.stopped) {
    await handle.close();
    return;
  }
  state.handle = handle;
  state.size = 0;
}

async function writeBatch(state, batch) {
  let offset = 0;
  while (offset < batch.length && !state.stopped) {
    const result = await state.handle.write(batch, offset, batch.length - offset, null);
    const written = result?.bytesWritten;
    if (!Number.isInteger(written) || written <= 0 || written > batch.length - offset) {
      throw new Error('Debug log write failed');
    }
    offset += written;
    state.size += written;
  }
  state.queuedBytes -= batch.length;
}

function enqueueDropped(state) {
  if (!state.dropped) return;
  const line = state.droppedLine(state.dropped);
  if (line.length > state.maxBytes || state.queuedBytes + line.length > state.queueLimit) return;
  state.queue.push(line);
  state.queuedBytes += line.length;
  state.dropped = 0;
}

async function drain(state) {
  enqueueDropped(state);
  while (state.queue.length && !state.stopped) {
    if (state.size + state.queue[0].length > state.maxBytes) await rotate(state);
    if (state.stopped) break;
    const batch = takeBatch(state);
    await writeBatch(state, batch);
    enqueueDropped(state);
  }
  if (state.closing || state.stopped) await releaseHandle(state);
}

function startDrain(state) {
  if (state.running || state.stopped) return;
  state.running = new Promise((resolve) => setImmediate(resolve)).then(() => drain(state)).catch(() => {
    state.stopped = true;
    state.queue = [];
    state.queuedBytes = 0;
    state.failed();
    return releaseHandle(state).catch(state.failed);
  }).finally(() => {
    state.running = undefined;
    if (state.queue.length && !state.stopped) startDrain(state);
  });
}

function stop(state) {
  state.stopped = true;
  state.queue = [];
  state.queuedBytes = 0;
  state.failed();
  void releaseHandle(state).catch(state.failed);
}

async function finish(state) {
  while (state.running) await state.running;
  await releaseHandle(state).catch(state.failed);
}

function closeSink(state) {
  if (state.closePromise) return state.closePromise;
  state.closing = true;
  if (!state.stopped) startDrain(state);
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      stop(state);
      resolve();
    }, state.closeTimeoutMs);
  });
  state.closePromise = Promise.race([finish(state), deadline]).then(() => {
    clearTimeout(timer);
  });
  return state.closePromise;
}

export function createDebugLogSink(options) {
  const state = {
    ...options, queue: [], queuedBytes: 0, size: 0, dropped: 0, stopped: false, closing: false,
  };
  return {
    enqueue(line) {
      if (state.stopped || state.closing) return;
      if (line.length > state.maxBytes || state.queuedBytes + line.length > state.queueLimit) {
        state.dropped = Math.min(Number.MAX_SAFE_INTEGER, state.dropped + 1);
        startDrain(state);
        return;
      }
      state.queue.push(line);
      state.queuedBytes += line.length;
      startDrain(state);
    },
    close: () => closeSink(state),
  };
}
