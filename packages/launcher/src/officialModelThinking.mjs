export const THINKING_ASSET_PREFIX = '/__open-kimi-assets/model-thinking-v1';

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

export function patchOfficialModelThinking(source, version) {
  const unchanged = { text: source, patched: false };
  if (version !== '2.7.2') return unchanged;
  const matches = [...source.matchAll(resolver)];
  if (matches.length !== 1) return unchanged;
  const { pick, supports, defaults } = matches[0].groups;
  const pickers = [...source.matchAll(pickerContract(pick))];
  if (pickers.length !== 1) return unchanged;
  const { alias, session, state, model, current, changed, next, choice, save } = pickers[0].groups;
  const selected = `${changed}&&${model}!==void 0`;
  const picker = pickers[0][0]
    .replace(choice, () => `!${changed}||${model}===void 0||${supports}(${model},${current})?${current}:${defaults}(${model})`)
    .replace(`${save}(${session},${alias},${next}===${current}?void 0:${next})`,
      () => `${save}(${session},${alias},${selected}?${next}:void 0)`)
    .replace(`${state}.draftThinkingExplicit=!1`, () => `${state}.draftThinkingExplicit=${selected}&&${next}!==void 0`);
  return { text: source.slice(0, pickers[0].index) + picker + source.slice(pickers[0].index + pickers[0][0].length),
    patched: true };
}
