export const THINKING_ASSET_PREFIX = '/__open-kimi-assets/model-thinking-v1';
export const THINKING_PREVIEW_ASSET_PREFIX = '/__open-kimi-assets/model-thinking-v2';

const id = '[\\w$]+';
const local = (name) => `(?<${name}>${id})`;
const use = (name) => `\\k<${name}>`;
const resolver = new RegExp(
  `function ${local('configured')}\\(${local('config')},${local('target')}\\)\\{` +
  `if\\(!\\k<config>\\|\\|typeof \\k<config>!="object"\\)return;` +
  `const\\{enabled:${local('enabled')},effort:${local('effort')}\\}=\\k<config>;` +
  `if\\(\\k<enabled>===!1\\)return ${local('supports')}\\(\\k<target>,"off"\\)\\?"off":void 0;` +
  'if\\(typeof \\k<effort>=="string"&&\\k<supports>\\(\\k<target>,\\k<effort>\\)\\)return \\k<effort>\\}' +
  `function ${local('pick')}\\(${local('model')},${local('current')},${local('changed')},${id}\\)\\{` +
  `return!\\k<changed>\\|\\|\\k<model>===void 0\\?\\k<current>:\\k<configured>\\(${id},\\k<model>\\)` +
  `\\?\\?${local('defaults')}\\(\\k<model>\\)\\}`, 'g');

function pickerContract(pick) {
  return new RegExp(
    `async function ${id}\\(${local('alias')}\\)\\{const ${local('session')}=${local('state')}\\.activeSessionId,` +
    `${local('model')}=${id}\\(${use('alias')}\\),${local('current')}=${use('state')}\\.thinking,` +
    `${local('changed')}=${id}\\(\\)!==\\(${use('model')}\\?\\.id\\?\\?${use('alias')}\\),` +
    `${local('next')}=(?<choice>${pick.replaceAll('$', '\\$')}\\(${use('model')},${use('current')},${use('changed')},` +
    `${use('session')}\\?void 0:${use('state')}\\.config\\?\\.thinking\\));` +
    `return ${use('session')}\\?\\(${use('next')}!==${use('current')}&&\\(${use('state')}\\.thinking=${use('next')}\\),` +
    `${local('save')}\\(${use('session')},${use('alias')},${use('next')}===${use('current')}\\?void 0:${use('next')}\\)\\):` +
    `\\(${id}\\.setDraftModel\\(${use('alias')}\\),${use('state')}\\.thinking=${use('next')},` +
    `${use('changed')}&&\\(${use('state')}\\.draftThinkingExplicit=!1\\),!0\\)\\}`, 'g');
}

function previewContract(pick) {
  return new RegExp(
    `${local('preview')}=${local('computed')}\\(\\(\\)=>${id}\\(${local('model')}\\.value,` +
    `(?<choice>${pick.replaceAll('$', '\\$')}\\(${use('model')}\\.value,${local('current')}\\.value,` +
    `(?<changed>${use('model')}\\.value\\?\\.id!==${id}\\.value\\?\\.id),` +
    `${local('session')}\\.value===null\\|\\|${use('session')}\\.value===void 0\\?` +
    `${id}\\.config\\.value\\?\\.thinking:void 0\\))\\)\\),` +
    `${id}=${use('computed')}\\(\\(\\)=>${local('explicit')}\\.value===void 0\\?${use('preview')}\\.value:` +
    `${id}\\(${use('model')}\\.value,${use('explicit')}\\.value\\)\\)`, 'g');
}

function retainedEffort({ supports, defaults }, model, current, changed) {
  return `!${changed}||${model}===void 0||${supports}(${model},${current})?${current}:${defaults}(${model})`;
}

function patchPreview(text, functions) {
  const previews = [...text.matchAll(previewContract(functions.pick))];
  if (previews.length !== 1) return null;
  const [preview] = previews;
  if (!text.startsWith('__name:"Composer",props:', text.lastIndexOf('__name:', preview.index))) return null;
  const { model, current, changed, choice } = preview.groups;
  const replace = retainedEffort(functions, `${model}.value`, `${current}.value`, `(${changed})`);
  return text.replace(preview[0], () => preview[0].replace(choice, () => replace));
}

export function patchOfficialModelThinking(source, version) {
  const unchanged = { text: source, patched: false };
  if (!['2.7.2', '2.8.0'].includes(version)) return unchanged;
  const matches = [...source.matchAll(resolver)];
  if (matches.length !== 1) return unchanged;
  const functions = matches[0].groups;
  const pickers = [...source.matchAll(pickerContract(functions.pick))];
  if (pickers.length !== 1) return unchanged;
  const { alias, session, state, model, current, changed, next, choice, save } = pickers[0].groups;
  const selected = `${changed}&&${model}!==void 0`;
  const picker = pickers[0][0]
    .replace(choice, () => retainedEffort(functions, model, current, changed))
    .replace(`${save}(${session},${alias},${next}===${current}?void 0:${next})`,
      () => `${save}(${session},${alias},${selected}?${next}:void 0)`)
    .replace(`${state}.draftThinkingExplicit=!1`, () => `${state}.draftThinkingExplicit=${selected}&&${next}!==void 0`);
  const text = source.replace(pickers[0][0], () => picker);
  if (version === '2.7.2') return { text, patched: true };
  const combined = patchPreview(text, functions);
  return combined === null ? unchanged : { text: combined, patched: true };
}
