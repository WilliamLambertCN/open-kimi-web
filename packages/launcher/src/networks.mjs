import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';

function isIpv6LinkLocal(address) {
  return /^fe[89ab][0-9a-f]:/i.test(address);
}

function isLoopback(address) {
  if (address === '::1') return true;
  return address.startsWith('127.');
}

function addressFamily(entry) {
  if (entry.family === 4 || entry.family === 'IPv4') return 4;
  if (entry.family === 6 || entry.family === 'IPv6') return 6;
  return isIP(entry.address);
}

function compareAddresses(left, right) {
  const leftFamily = isIP(left);
  const rightFamily = isIP(right);
  if (leftFamily !== rightFamily) return leftFamily - rightFamily;
  if (leftFamily === 4) {
    const leftParts = left.split('.').map(Number);
    const rightParts = right.split('.').map(Number);
    for (let i = 0; i < 4; i += 1) {
      if (leftParts[i] !== rightParts[i]) return leftParts[i] - rightParts[i];
    }
    return 0;
  }
  return left.localeCompare(right);
}

export function listNetworkAddresses(interfaces = networkInterfaces()) {
  const addresses = new Map();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      const family = addressFamily(entry);
      const address = entry.address.toLowerCase();
      if (entry.internal || !family || isLoopback(address)) continue;
      if (family === 6 && isIpv6LinkLocal(address)) continue;
      addresses.set(address, address);
    }
  }
  return [...addresses.values()].sort(compareAddresses);
}
