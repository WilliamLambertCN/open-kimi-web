export const IMAGE_PREVIEW_ASSET_PREFIX = '/__open-kimi-assets/image-preview-v1';

const id = '[\\w$]+';
const local = (name) => `(?<${name}>${id})`;
const use = (name) => `\\k<${name}>`;
const mediaDimensions = new RegExp(
  `async function ${id}\\(${id},${local('media')},${id},${local('signal')}\\)\\{` +
  `(?:(?!\\}function |\\}async function )[\\s\\S]){0,1200}?` +
  `const ${local('dimensions')}=${local('metadata')}\\(${use('media')}\\)\\?\\?` +
  `await ${local('probe')}\\(${local('url')},${use('signal')}\\);` +
  `return ${use('dimensions')}\\?\\{src:${use('url')},\\.\\.\\.${use('dimensions')},` +
  `objectUrl:${local('objectUrl')}\\}:\\(${use('objectUrl')}&&URL\\.revokeObjectURL\\(${use('objectUrl')}\\),null\\)\\}`, 'g');

export function patchOfficialImagePreview(source, version) {
  const unchanged = { text: source, patched: false };
  if (!['2.7.2', '2.8.0'].includes(version) || !source.includes('__name:"MediaLightbox"')) return unchanged;
  const matches = [...source.matchAll(mediaDimensions)];
  if (matches.length !== 1) return unchanged;
  const match = matches[0];
  const { metadata, media, probe, url, signal } = match.groups;
  const before = `${metadata}(${media})??await ${probe}(${url},${signal})`;
  const after = `await ${probe}(${url},${signal})??${metadata}(${media})`;
  const text = match[0].replace(before, after);
  return { text: source.slice(0, match.index) + text + source.slice(match.index + match[0].length), patched: true };
}
