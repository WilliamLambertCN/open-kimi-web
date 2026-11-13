const id = '[\\w$]+';
const regex = (pattern) => new RegExp(pattern, 'g');
const terminal = '["completed","failed","interrupted"]';

function helper() {
  return '\nfunction __okwConversationMetricSlots(turn){const slots=new Map();' +
    'for(const item of turn.items)if(item.type==="tool_call"||' +
    '((item.type==="assistant_message"||item.type==="reasoning")&&item.text.length>0))slots.set(item.step_index,item);' +
    'return slots;}\nfunction __okwConversationMetrics(item,turn,session,slots,steps){' +
    'const step=steps.get(item.step_index);' +
    `if(!step||!${terminal}.includes(step.outcome)||slots.get(step.index)!==item)return{};` +
    'return{debug:[{...item.debug,__okw:{session,turn:turn.turn_id,index:step.index,' +
    'item:item.item_id,type:item.type,state:step.outcome,ended:step.ended_at,usage:step.usage,' +
    'timing:item.debug?.timing}}]};}\n';
}

function projection(source) {
  const patterns = [...source.matchAll(regex(`for\\(const (${id}) of ${id}\\)\\{const ${id}=` +
    `\\1\\.items\\.find\\(${id}=>${id}\\.type==="user_message"&&${id}\\.placement==="opener"\\),` +
    `${id}=[^;]+?,(${id})=new Map\\(\\1\\.steps\\.map\\(${id}=>\\[${id}\\.index,${id}\\]\\)\\);` +
    `let ${id};\\1\\.items\\.forEach\\(\\((${id}),${id}\\)=>`))];
  const metadata = [...source.matchAll(regex(`chat:\\{id:${id},sessionId:(${id})\\.sessionId,role:"assistant"`))];
  const debug = [...source.matchAll(regex(`function (${id})\\((${id})\\)\\{return \\2\\.debug===void 0` +
    `\\?\\{\\}:\\{debug:\\[\\2\\.debug\\]\\}\\}`))];
  if (patterns.length !== 1 || metadata.length !== 1 || debug.length !== 1) return null;
  const [header, turn, steps, item] = patterns[0];
  const literal = (value) => value.replaceAll('$', '\\$');
  const calls = regex(`\\.\\.\\.${literal(debug[0][1])}\\(${literal(item)}\\)`);
  if ([...source.matchAll(calls)].length !== 3) return null;
  const indexed = source.replace(header, () => header.replace(';let ',
    `;const __okwMetricSlots=__okwConversationMetricSlots(${turn});let `));
  return indexed.replace(calls, () =>
    `...__okwConversationMetrics(${item},${turn},${metadata[0][1]}.sessionId,__okwMetricSlots,${steps})`);
}

function row(source) {
  const component = [...source.matchAll(regex(`__name:"RequestDebugRow",props:\\{debug:\\{\\}\\},` +
    `setup\\((${id})\\)\\{const (${id})=\\1,`))];
  const renders = [...source.matchAll(regex(`(${id})\\("div",\\{class:"request-debug",role:"note",` +
    `title:${id}\\.value\\},${id}\\(${id}\\.value\\),9,${id}\\)`))];
  const consumers = [...source.matchAll(regex(`\\.debug\\?\\?\\[\\],\\(${id},${id}\\)=>` +
    `\\(${id}\\(\\),${id}\\(${id},\\{key:${id},debug:${id}\\},null,8,\\["debug"\\]\\)\\)`))];
  if (component.length !== 1 || renders.length !== 1 || consumers.length !== 3) return null;
  const props = component[0][2];
  return source.replace(renders[0][0], `${renders[0][1]}("div",{class:"step-timing",` +
    `"data-okw-step-id":JSON.stringify([${props}.debug.__okw?.turn,${props}.debug.__okw?.index,` +
    `${props}.debug.__okw?.item]),"data-okw-step-state":${props}.debug.__okw?.state,` +
    `"data-okw-conversation":JSON.stringify(${props}.debug.__okw)},null,8,` +
    '["data-okw-step-id","data-okw-step-state","data-okw-conversation"])');
}

export function patchOfficialConversationMetrics(source) {
  if (!source.includes('__name:"RequestDebugRow"')) return { text: source, patched: false };
  const projected = projection(source);
  const text = projected === null ? null : row(projected);
  return text === null ? { text: source, patched: false } : { text: text + helper(), patched: true };
}
