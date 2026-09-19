import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';

// Interface names that belong to hypervisors, containers, tunnels, or other
// virtual adapters: advertising their addresses as Network links/TLS SANs
// mostly produces unreachable clutter (WSL, Hyper-V, VMware, Docker, VPNs).
const VIRTUAL_INTERFACE_RE =
  /vethernet|vmware|hyper-v|virtualbox|vbox|tap-|tun2?|wsl|docker|loopback|pseudo|isatap/i;
const VIRTUAL_POSIX_PREFIX_RE = /^(veth|docker|br-|virbr|vmnet|tailscale|utun|tun|tap)/i;

export function isVirtualInterfaceName(name) {
  if (typeof name !== 'string' || name === '') return false;
  return VIRTUAL_INTERFACE_RE.test(name) || VIRTUAL_POSIX_PREFIX_RE.test(name);
}

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

function listableAddress(entry) {
  const family = addressFamily(entry);
  const address = entry.address.toLowerCase();
  if (entry.internal || !family || isLoopback(address)) return null;
  if (family === 6 && isIpv6LinkLocal(address)) return null;
  return address;
}

// Virtual adapters are filtered by interface name when one is available;
// nameless entries (non-standard fixtures) are conservatively kept.
export function listNetworkAddresses(interfaces = networkInterfaces()) {
  const addresses = new Map();
  for (const [name, entries] of Object.entries(interfaces)) {
    if (isVirtualInterfaceName(name)) continue;
    for (const entry of entries ?? []) {
      const address = listableAddress(entry);
      if (address !== null) addresses.set(address, address);
    }
  }
  return [...addresses.values()].sort(compareAddresses);
}
