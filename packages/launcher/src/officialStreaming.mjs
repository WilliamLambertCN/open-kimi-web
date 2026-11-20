import { patchActivityFolding } from './officialActivityFolding.mjs';

const identifier = '[\\w$]+';
const markdown = new RegExp(
  `mode:"chat",(?:(?!\\}\\),null,8,\\[).){0,1500}?final:${identifier}\\.value,` +
  `"show-tooltips":!1,"smooth-streaming":${identifier}\\.streaming,"batch-rendering":${identifier}\\.value`, 'g');

export function patchOfficialStreaming(source, version) {
  if (version !== '2.6.3' || !source.includes('__name:"Markdown"')) return { text: source, patched: false };
  const matches = [...source.matchAll(markdown)];
  if (matches.length !== 1) return { text: source, patched: false };
  const text = source.replace(markdown, (match) =>
    match.replace(/"smooth-streaming":[\w$]+\.streaming/, '"smooth-streaming":!1'));
  return { text: patchActivityFolding(text), patched: true };
}
