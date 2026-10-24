const HEX_BYTE = /^[\da-f]{2}$/i;

function decodePathBytes(pathname) {
  const decoded = [];
  for (const char of pathname) {
    decoded.push(char);
    while (decoded.length >= 3 && decoded.at(-3) === '%' && HEX_BYTE.test(decoded.at(-2) + decoded.at(-1))) {
      const byte = Number.parseInt(decoded.slice(-2).join(''), 16);
      decoded.length -= 3;
      decoded.push(String.fromCharCode(byte));
    }
  }
  return decoded.join('');
}

function isApiNamespace(requestUrl, namespace) {
  const pathname = requestUrl.split(/[?#]/, 1)[0];
  const segments = [];
  for (const segment of decodePathBytes(pathname).split(/[\\/]+/)) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
    if (segments.length === 3 && segments[0] === 'api' && segments[1] === 'v1' && segments[2] === namespace) {
      return true;
    }
  }
  return false;
}

export const isDebugApiPath = (requestUrl) => isApiNamespace(requestUrl, 'debug');
export const isRemoteControlApiPath = (requestUrl) => isApiNamespace(requestUrl, 'remote-control');
