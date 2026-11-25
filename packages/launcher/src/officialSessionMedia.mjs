export const SESSION_MEDIA_ASSET_PREFIX = '/__open-kimi-assets/session-media-v1';

const id = '[\\w$]+';
const local = (name) => `(?<${name}>${id})`;
const use = (name) => `\\k<${name}>`;
const dispatch = new RegExp(
  `dispatch\\(${local('method')},${local('route')},${local('args')}\\)\\{` +
  `const ${local('key')}=${use('args')}\\[0\\];` +
  `if\\(${use('route')}==="session"\\|\\|${use('route')}==="localSession"\\)\\{` +
  `const ${local('owner')}=this\\.sessionHost\\.get\\(${use('key')}\\);` +
  `return ${use('owner')}===void 0\\?this\\.dispatchUnknownSession\\(${use('method')},${use('route')},${use('args')}\\):` +
  `this\\.dispatchSession\\(${use('method')},${use('route')},${use('args')},${use('owner')}\\?\\?void 0\\)\\}` +
  `const ${local('host')}=${use('route')}==="workspace"\\?this\\.workspaceHost\\.get\\(${use('key')}\\):` +
  `${use('route')}==="file"\\?this\\.fileHost\\.get\\(${use('key')}\\):void 0,` +
  `${local('api')}=this\\.apiFor\\(${use('host')}\\);return ${use('api')}\\[${use('method')}\\]\\.apply\\(` +
  `${use('api')},${use('args')}\\)\\}`, 'g');
const ownerLookup = new RegExp(
  `async ownerOf\\(${local('session')}\\)\\{const ${local('owner')}=this\\.sessionHost\\.get\\(${use('session')}\\);` +
  `if\\(${use('owner')}!==void 0\\)return ${use('owner')}\\?\\?void 0;` +
  `if\\(await this\\.whenReady\\(\\),this\\.hosts\\.size!==0\\)return this\\.lookUp\\(${use('session')}\\)` +
  `\\.then\\(${local('result')}=>${use('result')}\\.hostId\\)\\}`, 'g');

export function patchOfficialSessionMedia(source, version) {
  const unchanged = { text: source, patched: false };
  if (version !== '2.7.2' || source.includes('sessionSync')) return unchanged;
  const fileRoutes = [...source.matchAll(/\bgetFileDownloadUrl:"session"/g)];
  const mediaRoutes = [...source.matchAll(/\bgetSessionMediaUrl:"session"/g)];
  const dispatches = [...source.matchAll(dispatch)];
  if (fileRoutes.length !== 1 || mediaRoutes.length !== 1 || dispatches.length !== 1 ||
      [...source.matchAll(ownerLookup)].length !== 1) return unchanged;
  const match = dispatches[0];
  const { method, route, args, key, owner, api } = match.groups;
  const sync = `if(${route}==="sessionSync"){const ${owner}=this.sessionHost.get(${key});` +
    `if(${owner}===void 0)void this.ownerOf(${key}).catch(()=>void 0);` +
    `const ${api}=this.apiFor(${owner}??void 0);return ${api}[${method}].apply(${api},${args})}`;
  const at = match.index + match[0].indexOf(`if(${route}==="session"`);
  const edits = [
    { at, end: at, value: sync },
    ...[fileRoutes[0], mediaRoutes[0]].map((routeMatch) => ({
      at: routeMatch.index, end: routeMatch.index + routeMatch[0].length,
      value: routeMatch[0].replace('"session"', '"sessionSync"'),
    })),
  ].sort((a, b) => b.at - a.at);
  let text = source;
  for (const edit of edits) text = text.slice(0, edit.at) + edit.value + text.slice(edit.end);
  return { text, patched: true };
}
