export function parseVersion(version) {
  if (typeof version !== 'string') return null;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-r([1-9]\d*))?$/.exec(version);
  if (!match) return null;
  return match.slice(1).map((part) => BigInt(part ?? 0));
}

export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) throw new Error('unsupported stable launcher version');
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}

export function assertNodeEngine(manifest, current = process.versions.node) {
  const match = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(manifest.engines?.node ?? '');
  if (!match) throw new Error('target Node engine range cannot be safely verified; update manually');
  const minimum = match.slice(1).join('.');
  if (compareVersions(current, minimum) < 0) throw new Error(`target requires Node ${manifest.engines.node}`);
}
