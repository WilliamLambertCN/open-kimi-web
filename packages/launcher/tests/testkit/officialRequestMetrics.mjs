export const nativeTimingFixture = [
  'const Timing={__name:"StepTimingDebug"};',
  'function build(r,A,a){r?.includeStepTiming===!0&&(A.llmTiming!==void 0||A.usage!==void 0)&&a.push({',
  'metadata:{[Timing]:{llmTiming:A.llmTiming,usage:A.usage}}});}',
  'function convert(y){return{kind:"stepTiming",llmTiming:y.llmTiming,usage:y.usage};}',
  'function group(n){const i=[];let o=[];const r=()=>{const[l]=o;',
  'o.length===1&&l?i.push(l):o.length>1&&i.push({kind:"activity-run",items:o}),o=[]},a=()=>{};',
  'n.forEach((l,c)=>{if(l.kind==="stepTiming"){r(),a(),',
  'i.push({kind:"stepTiming",llmTiming:l.llmTiming,usage:l.usage,sourceIndex:c});return}',
  'if(l.kind==="tool"||l.kind==="thinking"){o.push({...l,sourceIndex:c});return}r(),i.push(l)});r();return i;}',
  'function render(se,O,Lt){',
  'se(Timing,{key:4,"llm-timing":O.llmTiming,usage:O.usage},null,8,["llm-timing","usage"]);',
  'se(Timing,{key:4,"llm-timing":Lt.llmTiming,usage:Lt.usage},null,8,["llm-timing","usage"]);}',
  'function filter(d,Bt,Ye){const allowed=(d.stepDebug||Bt.kind!=="stepTiming");',
  'return d.stepDebug?Ye:Ye.filter(qe=>qe.kind!=="stepTiming");}',
  'const main={default:ee(({item:Lt,index:ai})=>[Lt.kind==="thinking"?',
  '(v(),se(qA,{text:Lt.thinking},null,8,["text","streaming","started-at","duration-ms","instant-reveal"])):',
  'Lt.kind==="notification"?(v(),se(Jhe,{key:5,items:Lt.items},null,8,["items"])):Q("",!0)])};',
  'const folded={default:ee(({item:O})=>[O.kind==="thinking"?',
  '(v(),se(qA,{text:O.thinking},null,8,["text","mobile","streaming","started-at","duration-ms"])):',
  'O.kind==="notification"?(v(),se(Jhe,{key:5,items:O.items},null,8,["items"])):Q("",!0)])};',
  'const activity={default:ee(({item:V})=>[V.kind==="thinking"?',
  '(v(),se(qA,{text:V.thinking},null,8,["text","mobile","streaming","started-at","duration-ms","instant-reveal"])):',
  'V.kind==="browser-retry"?(v(),se(YA,{item:V},null,8,["item","mobile"])):',
  '(v(),se(YA,{tool:V.tool},null,8,["tool","mobile","resolve-file-path","resolve-image"]))])};',
  'const retry={default:ee(()=>[y.kind==="thinking"?',
  '(v(),se(qA,{text:y.thinking},null,8,["text","mobile","started-at","duration-ms"])):',
  '(v(),se(YA,{tool:y.tool},null,8,["tool","mobile"]))])};',
  'function head(){return w("button",{type:"button",class:"st-head"})}',
].join('');

export const fixturePrelude = 'const ee=f=>f;const y={kind:"tool"};' +
  'const w=(tag,props)=>({tag,props});const v=()=>{};const Q=()=>null;const YA={},qA={},Jhe={};' +
  'const se=(component,props,children,flag,dynamic)=>({component,props,children,dynamic});\n';
