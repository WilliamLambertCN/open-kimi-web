// __wrap routing: decide whether an intercepted `kimi …` invocation is
// delegated untouched to the real binary or supervised as an OpenWeb
// frontend. Only losslessly understood `kimi web` argument sets are
// supervised; everything else delegates.

const DELEGATE_FLAGS = new Set([
  '--rc',
  '--remote-control',
  '--dangerous-bypass-auth',
]);

function delegate(reason) {
  return { action: 'delegate', reason };
}

function unsupported(args) {
  return delegate(`passing through to official kimi (unsupported arguments: ${args.join(' ')})`);
}

function parseWebArgs(rest) {
  const options = { port: undefined, host: undefined, hostBare: false, noOpen: false };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--no-open') {
      options.noOpen = true;
    } else if (arg === '--port') {
      const value = rest[i + 1];
      if (value === undefined || !/^\d+$/.test(value)) return unsupported(rest.slice(i));
      const port = Number(value);
      if (port > 65535) return unsupported(rest.slice(i));
      options.port = port;
      i += 1;
    } else if (arg === '--host') {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith('--')) {
        options.hostBare = true;
      } else {
        options.host = value;
        i += 1;
      }
    } else {
      return unsupported(rest.slice(i));
    }
  }
  return { action: 'supervise', options };
}

export function routeWrapArgv(argv) {
  if (argv[0] !== 'web') return { action: 'delegate', reason: null };
  const rest = argv.slice(1);
  if (rest[0] === 'rotate-token') {
    return delegate('passing through to official kimi (web rotate-token manages server auth)');
  }
  const delegated = rest.find((arg) => DELEGATE_FLAGS.has(arg));
  if (delegated !== undefined) {
    return delegate(`passing through to official kimi (${delegated} is not supervised)`);
  }
  return parseWebArgs(rest);
}
