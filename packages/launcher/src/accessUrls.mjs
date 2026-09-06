import { isIP } from 'node:net';

import { listNetworkAddresses } from './networks.mjs';

const IPV4_WILDCARD = '0.0.0.0';
const IPV6_WILDCARDS = new Set(['::', '[::]']);
const LOOPBACK_HOSTS = new Set(['localhost', '::1', '[::1]']);

function stripIpv6Brackets(host) {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

export function formatAccessUrl(host, port, protocol = 'http') {
  const bareHost = stripIpv6Brackets(host);
  const urlHost = isIP(bareHost) === 6 ? `[${bareHost}]` : bareHost;
  return `${protocol}://${urlHost}:${port}`;
}

export function withTokenFragment(url, token) {
  return `${url}#token=${encodeURIComponent(token)}`;
}

export function isLoopbackHost(host) {
  const normalized = host.toLowerCase();
  return LOOPBACK_HOSTS.has(normalized) || normalized.startsWith('127.');
}

export function isWildcardHost(host) {
  return host === IPV4_WILDCARD || IPV6_WILDCARDS.has(host);
}

export function createAccessUrls(host, port, interfaces, protocol = 'http') {
  if (isWildcardHost(host)) {
    const localHost = host === IPV4_WILDCARD ? '127.0.0.1' : '::1';
    const local = { type: 'local', url: formatAccessUrl(localHost, port, protocol) };
    const network = listNetworkAddresses(interfaces).map((address) => ({
      type: 'network',
      url: formatAccessUrl(address, port, protocol),
    }));
    return [local, ...network];
  }
  const type = isLoopbackHost(host) ? 'local' : 'network';
  return [{ type, url: formatAccessUrl(host, port, protocol) }];
}
