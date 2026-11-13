import { patchOfficialConversationMetrics } from './officialConversationMetrics.mjs';

export const METRICS_ASSET_PREFIX = '/__open-kimi-assets/step-metrics-v3';
const identifier = '[\\w$]+';
const rule = (pattern, count, replace) => ({ pattern: new RegExp(pattern, 'g'), count, replace });
const itemSlot = `default:${identifier}\\(\\(\\{item:(${identifier})(?:,index:${identifier})?\\}\\)=>` +
  `\\[\\1\\.kind==="thinking"\\?`;
const slotContent = '(?:(?!default:)[\\s\\S])*?';
const appendTimingSlots = (match, item) => match.slice(0, -2) + `,...__okwTimingSlots(${item})])`;
const rules = (pending) => [
  rule(`(${identifier})\\?\\.includeStepTiming===!0&&\\((${identifier})\\.llmTiming!==void 0\\|\\|\\2\\.usage!==void 0\\)&&`,
    1, (_, options, step) => `(${step}.llmTiming!==void 0||${step}.usage!==void 0||` +
      `["completed","failed","interrupted"].includes(${step}.state))&&${step}.frames.some(__okwRenderableFrame)&&`),
  rule(`metadata:\\{\\[(${identifier})\\]:\\{llmTiming:(${identifier})\\.llmTiming,usage:\\2\\.usage\\}\\}`, 1,
    (_, key, step) => `metadata:{[${key}]:{stepId:${step}.stepId,state:${step}.state,` +
      `llmTiming:${step}.llmTiming,usage:${step}.usage}}`),
  rule(`kind:"stepTiming",llmTiming:(${identifier})\\.llmTiming,usage:\\1\\.usage`, 2,
    (_, item) => `kind:"stepTiming",stepId:${item}.stepId,state:${item}.state,` +
      `llmTiming:${item}.llmTiming,usage:${item}.usage`),
  rule(`if\\((${identifier})\\.kind==="stepTiming"\\)\\{(${identifier})\\(\\),(${identifier})\\(\\),` +
    `(${identifier})\\.push\\((\\{kind:"stepTiming",stepId:\\1\\.stepId,state:\\1\\.state,` +
    `llmTiming:\\1\\.llmTiming,usage:\\1\\.usage,sourceIndex:${identifier}\\})\\);return\\}`, 1,
    (...match) => {
      const [, item, flush, notices, blocks, timing] = match;
      return `if(${item}.kind==="stepTiming"){if(__okwAttachTiming(${timing},${pending},${blocks}))return;` +
        `${flush}(),${notices}(),${blocks}.push(${timing});return}`;
    }),
  rule(`"llm-timing":(${identifier})\\.llmTiming,usage:\\1\\.usage\\},null,8,\\["llm-timing","usage"\\]`, 2,
    (_, item) => `"llm-timing":${item}.llmTiming,usage:${item}.usage,` +
      `"data-okw-step-id":${item}.stepId,"data-okw-step-state":${item}.state},null,8,` +
      '["llm-timing","usage","data-okw-step-id","data-okw-step-state"]'),
  rule(`\\((${identifier})\\.stepDebug\\|\\|(${identifier})\\.kind!=="stepTiming"\\)`, 1, '(!0)'),
  rule(`return (${identifier})\\.stepDebug\\?(${identifier}):\\2\\.filter\\((${identifier})=>\\3\\.kind!=="stepTiming"\\)`,
    1, (_, props, items) => `return ${items}`),
  rule(itemSlot + slotContent + `\\1\\.kind==="notification"\\?\\(${identifier}\\(\\),` +
    `${identifier}\\(${identifier},\\{key:5,items:\\1\\.items\\},null,8,\\["items"\\]\\)\\):` +
    `${identifier}\\("",!0\\)\\]\\)`, 2, appendTimingSlots),
  rule(itemSlot + slotContent + ',null,8,\\["tool","mobile","resolve-file-path","resolve-image"\\]\\)\\)\\]\\)',
    1, appendTimingSlots),
  rule(`default:${identifier}\\(\\(\\)=>\\[(${identifier})\\.kind==="thinking"\\?` + slotContent +
    ',null,8,\\["tool","mobile"\\]\\)\\)\\]\\)', 1, appendTimingSlots),
];

function timingHelpers(element) {
  return '\nfunction __okwRenderableFrame(frame){return frame.kind==="tool"||' +
    '(frame.kind==="thinking"&&frame.text.length>0)||(frame.kind==="text"&&frame.role==="assistant"&&' +
    '(frame.text.length>0||(frame.attachmentIds??[]).length>0));}' +
    '\nfunction __okwAttachTiming(timing,pending,blocks){const previous=pending.at(-1);' +
    'if(!previous)return blocks.at(-1)?.kind==="stepTiming";' +
    'if(!previous.okwTimings)previous.okwTimings=[timing];return true;}' +
    '\nfunction __okwTimingSlots(block){return(block.okwTimings??[]).map(t=>' +
    `${element}("div",{class:"step-timing","data-okw-step-id":t.stepId,"data-okw-step-state":t.state},null,8,` +
    '["data-okw-step-id","data-okw-step-state"]));}\n';
}

export function patchOfficialRequestMetrics(source) {
  if (!source.includes('__name:"StepTimingDebug"')) return patchOfficialConversationMetrics(source);
  const elements = [...source.matchAll(new RegExp(`(${identifier})\\("button",\\{type:"button",class:"st-head"`, 'g'))];
  const pending = [...source.matchAll(new RegExp(`kind:"activity-run",items:(${identifier})\\}` , 'g'))];
  if (elements.length !== 1 || pending.length !== 1) return { text: source, patched: false };
  let text = source;
  for (const { pattern, count, replace } of rules(pending[0][1])) {
    if ([...text.matchAll(pattern)].length !== count) return { text: source, patched: false };
    text = text.replace(pattern, replace);
  }
  return { text: text + timingHelpers(elements[0][1]), patched: true };
}

export function metricsAssetPaths(source) {
  return source.replace(/(["'`(])(\/?)assets\//g, (_, start, slash) =>
    `${start}${slash}${METRICS_ASSET_PREFIX.slice(1)}/assets/`);
}
