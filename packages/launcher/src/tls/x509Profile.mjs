const SHA256_RSA = '2a864886f70d01010b';
const BASIC_CONSTRAINTS = '551d13';
const KEY_USAGE = '551d0f';
const EXTENDED_KEY_USAGE = '551d25';
const SERVER_AUTH = '2b06010505070301';

function readNode(data, offset = 0) {
  const tag = data[offset++];
  let size = data[offset++];
  if (size & 0x80) {
    const count = size & 0x7f;
    if (count === 0 || count > 4) throw new Error('invalid DER length');
    size = 0;
    for (let index = 0; index < count; index++) size = size * 256 + data[offset++];
  }
  const end = offset + size;
  if (!Number.isSafeInteger(end) || end > data.length) throw new Error('invalid DER bounds');
  return { tag, data: data.subarray(offset, end), end };
}

function children(data) {
  const result = [];
  for (let offset = 0; offset < data.length;) {
    const node = readNode(data, offset);
    result.push(node);
    offset = node.end;
  }
  return result;
}

function certificateExtensions(raw) {
  const certificate = children(readNode(raw).data);
  const algorithm = children(certificate[1].data)[0];
  if (algorithm.tag !== 6 || algorithm.data.toString('hex') !== SHA256_RSA) {
    throw new Error('certificate must use RSA/SHA-256');
  }
  const fields = children(certificate[0].data);
  const tbsAlgorithm = children(fields[2].data)[0];
  if (!algorithm.data.equals(tbsAlgorithm.data)) throw new Error('inconsistent signature algorithm');
  const wrapper = fields.find((field) => field.tag === 0xa3);
  if (!wrapper) throw new Error('certificate extensions missing');
  const extensions = new Map();
  for (const extension of children(readNode(wrapper.data).data)) {
    const parts = children(extension.data);
    const oid = parts[0].data.toString('hex');
    if (extensions.has(oid)) throw new Error('duplicate certificate extension');
    extensions.set(oid, {
      critical: parts[1].tag === 1 && parts[1].data.equals(Buffer.from([0xff])),
      value: parts.at(-1).data,
    });
  }
  return extensions;
}

function requireExtension(extensions, oid, expected) {
  const extension = extensions.get(oid);
  if (!extension?.critical || extension.value.toString('hex') !== expected) {
    throw new Error('certificate has an invalid constraints or usage profile');
  }
}

export function assertCertificateProfile(certificate, root) {
  const extensions = certificateExtensions(certificate.raw);
  requireExtension(extensions, BASIC_CONSTRAINTS, root ? '30060101ff020100' : '3000');
  requireExtension(extensions, KEY_USAGE, root ? '03020106' : '030205a0');
  if (root) {
    if (extensions.has(EXTENDED_KEY_USAGE)) throw new Error('CA must not restrict extended key usage');
    return;
  }
  requireExtension(extensions, EXTENDED_KEY_USAGE, `300a0608${SERVER_AUTH}`);
}
