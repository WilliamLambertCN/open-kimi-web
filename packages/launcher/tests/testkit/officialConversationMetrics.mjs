export const conversationFixture = [
  'const V=x=>x,E=f=>({get value(){return f()}}),L=x=>x,A=(tag,props,children)=>({tag,props,children}),v=()=>{};',
  'const Timing=V({__name:"RequestDebugRow",props:{debug:{}},setup(e){const t=e,n=E(()=>"native"),i=E(()=>"");',
  'return(o,s)=>(v(),A("div",{class:"request-debug",role:"note",title:i.value},L(n.value),9,Attrs))}}),Attrs=["title"];',
  'function project(e){const n={sessionId:"session"},all=[];',
  'const reply="reply",holder={chat:{id:reply,sessionId:n.sessionId,role:"assistant"}};',
  'for(const p of e){const m=p.items.find(C=>C.type==="user_message"&&C.placement==="opener"),',
  'g=m===void 0?void 0:m.prompt_ids[0]??p.turn_id,w=new Map(p.steps.map(C=>[C.index,C]));let y;',
  'p.items.forEach((C,x)=>{switch(C.type){',
  'case"assistant_message":all.push({kind:"text",text:C.text,...mS(C)});break;',
  'case"reasoning":all.push({kind:"thinking",thinking:C.text,...mS(C)});break;',
  'case"tool_call":all.push({kind:"tool",tool:C,...mS(C)});break;}})}return all;}',
  'function mS(e){return e.debug===void 0?{}:{debug:[e.debug]}}',
  'function ij(e,t){return e.debug===void 0&&t.debug===void 0?{}:{debug:[...e.debug??[],...t.debug??[]]}}',
  'const st=(items,f)=>items.map(f),oe=(component,props)=>({component,props});',
  'function main(W){return st(W.debug??[],(K,se)=>(v(),oe(Timing,{key:se,debug:K},null,8,["debug"])))}',
  'function folded(F){return st(F.debug??[],(V,N)=>(v(),oe(Timing,{key:N,debug:V},null,8,["debug"])))}',
  'function activity(Nt){return st(Nt.debug??[],(po,Nr)=>(v(),oe(Timing,{key:Nr,debug:po},null,8,["debug"])))}',
].join('');

export const conversationTurn = (extra = {}) => ({ turn_id: 't_123456789abc', ordinal: 0, kind: 'agent',
  status: 'ended', outcome: 'completed', steps: [{ index: 1, outcome: 'completed', ended_at: '2026-01-01T00:00:10.000Z',
    usage: { output: 100, input_other: 10, input_cache_read: 30, input_cache_creation: 0 } }], items: [
    { type: 'reasoning', item_id: 'step-uuid:0', step_index: 1, text: 'Fictional reasoning', status: 'ended' },
    { type: 'assistant_message', item_id: 'step-uuid:1', step_index: 1, text: 'Fictional response', status: 'ended' },
  ], ...extra });
