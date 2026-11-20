import { describe, expect, it } from 'vitest';
import { patchOfficialStreaming } from '../src/officialStreaming.mjs';

const markdown = 'const component={__name:"Markdown"};' +
  'function render(props,final,batch){return {mode:"chat",other:true,final:final.value,' +
  '"show-tooltips":!1,"smooth-streaming":props.streaming,"batch-rendering":batch.value}}';

describe('official streaming presentation', () => {
  it('disables only the chat Markdown smoothing, leaving streaming and final semantics intact', async () => {
    const result = patchOfficialStreaming(markdown, '2.6.3');
    expect(result.patched).toBe(true);
    const encoded = Buffer.from(result.text + '\nexport {render}').toString('base64');
    const module = await import(`data:text/javascript;base64,${encoded}`);
    expect(module.render({ streaming: true }, { value: false }, { value: true })).toEqual({
      mode: 'chat', other: true, final: false, 'show-tooltips': false, 'smooth-streaming': false, 'batch-rendering': true,
    });
    expect(module.render({ streaming: false }, { value: true }, { value: false }).final).toBe(true);
  });
  it('allows identifiers to change without binding to a bundle filename or minified variable', () => {
    const source = markdown.replaceAll('props', '$props').replaceAll('final.value', '$finish.value');
    expect(patchOfficialStreaming(source, '2.6.3').patched).toBe(true);
  });
  it.each(['2.6.1', '2.6.4', '2.6.3-beta.1', undefined])('does not patch an unverified version %s', (version) => {
    expect(patchOfficialStreaming(markdown, version)).toEqual({ patched: false, text: markdown });
  });
  it('retains the original when the relevant structure is missing, changed or duplicated', () => {
    const samples = [markdown.replace('__name:"Markdown"', '__name:"Other"'),
      markdown.replace('mode:"chat"', 'mode:"other"'), markdown.replace('"show-tooltips":!1', '"show-tooltips":!0'),
      markdown.replace('props.streaming', 'props.value'), markdown + markdown];
    for (const source of samples) expect(patchOfficialStreaming(source, '2.6.3')).toEqual({ patched: false, text: source });
  });
});
