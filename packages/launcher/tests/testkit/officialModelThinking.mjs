export const registry = `
function supports(model,effort){return model.efforts.includes(effort)}
function defaults(model){return model.defaultEffort}
function configured(config,target){if(!config||typeof config!="object")return;` +
  'const{enabled:on,effort:level}=config;if(on===!1)return supports(target,"off")?"off":void 0;' +
  'if(typeof level=="string"&&supports(target,level))return level}' +
  'function pick(model,current,changed,global){return!changed||model===void 0?current:configured(global,model)??defaults(model)}';

export const switcher = 'async function apply(alias){const sid=state.activeSessionId,model=get(alias),current=state.thinking,' +
  'changed=active()!==(model?.id??alias),next=pick(model,current,changed,sid?void 0:state.config?.thinking);' +
  'return sid?(next!==current&&(state.thinking=next),save(sid,alias,next===current?void 0:next)):' +
  '(store.setDraftModel(alias),state.thinking=next,changed&&(state.draftThinkingExplicit=!1),!0)}';

export const modelThinkingFixture = registry + switcher;
