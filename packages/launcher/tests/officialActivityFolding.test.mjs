import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { patchActivityFolding } from '../src/officialActivityFolding.mjs';

const component = '({__name:"ActivityRun",setup(){' +
  'const{activityRunFolding:fold}=settings(),' +
  'open=computed(()=>props.forceOpen||!fold.value||expanded.value),shown=ref(open.value);' +
  'watch(state,(next,old,cleanup)=>{if(next==="running")return;old==="running"&&(expanded.value=!1,finish())});' +
  'watch(fold,()=>{expanded.value=state.value==="running"});' +
  'function click(){if(props.forceOpen||(expanded.value=!expanded.value,props.streaming))return;}' +
  'return {open,click,head:{ref_key:"headEl",ref:el,class:["ar-head"]}}}}, {__name:"Next"})';

function mount({ following = true, y = 60, forceOpen = false, folding = true } = {}) {
  const watches = new Map(), ref = value => ({ value });
  const state = ref('done'), expanded = ref(true), fold = ref(folding), finish = vi.fn();
  const pane = { scrollHeight: 800, clientHeight: 400, getBoundingClientRect: () => ({ top: 0, bottom: 400 }),
    classList: { contains: () => following } };
  const group = { closest: () => following ? pane : null, getBoundingClientRect: () => ({ top: y, bottom: y + 50 }) };
  const disconnect = vi.fn(); let notify, unmount;
  class IntersectionObserver {
    constructor(fn, { root }) { expect(root).toBe(pane); notify = fn; }
    observe(el) { expect(el).toBe(group); }
    disconnect = disconnect;
  }
  const code = patchActivityFolding(component).replace('}}, {__name:"Next"})', '}}).setup()');
  const { open, click } = runInNewContext(code, { props: { forceOpen }, finish, ref, expanded, state, settings: () => ({
    activityRunFolding: fold }), computed: fn => ({ get value() { return fn(); } }), IntersectionObserver,
    el: ref({ closest: () => group }), watch: (key, fn) => watches.set(key, fn) });
  watches.get(state)('done', 'running', fn => { unmount = fn; });
  return { open, click, expanded, finish, disconnect, unmount, preference: watches.get(fold),
    leave: () => notify([{ isIntersecting: false, boundingClientRect: { bottom: -1 } }]),
    stopFollowing: () => { following = false; } };
}

describe('automatic activity folding while following', () => {
  it('finishes immediately, keeping only the visible group open until it leaves', () => {
    const ui = mount();
    expect(ui.finish).toHaveBeenCalledOnce();
    expect(ui.expanded.value).toBe(false);
    expect(ui.open.value).toBe(true);
    ui.leave(); expect(ui.open.value).toBe(false);
    expect(ui.disconnect).toHaveBeenCalledOnce();
  });
  it('honors the first manual collapse and the next explicit expansion', () => {
    const ui = mount();
    ui.click(); expect(ui.open.value).toBe(false);
    expect(ui.disconnect).toHaveBeenCalledOnce();
    ui.click(); ui.unmount(); expect(ui.open.value).toBe(true);
  });
  it('does not shrink content above a reader who has stopped following; cleans up on unmount or preference change', () => {
    for (const action of ['unmount', 'preference']) {
      const ui = mount(); ui.stopFollowing(); ui.leave();
      expect(ui.open.value).toBe(true);
      ui[action](); expect(ui.open.value).toBe(false);
      expect(ui.disconnect).toHaveBeenCalledOnce();
    }
  });
  it.each([[{ following: false }, false], [{ y: -100 }, false], [{ y: 500 }, false],
    [{ folding: false }, true], [{ forceOpen: true }, true]])('keeps upstream behavior for %o', (options, open) => {
    const ui = mount(options);
    expect(ui.open.value).toBe(open); expect(ui.unmount).toBeUndefined();
  });
  it('retains the untouched component when a required anchor is missing or ambiguous', () => {
    for (const source of [component + component, component.replace('"headEl"', '"other"'),
      component.replace('if(next==="running")', 'if(!next)'), component.replace('old==="running"', '!old'),
      component.replace('watch(fold,', 'observe(fold,'), component.replace('props.streaming)', 'props.live)')]) {
      expect(patchActivityFolding(source)).toBe(source);
    }
  });
});
