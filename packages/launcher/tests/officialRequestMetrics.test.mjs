import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { METRICS_ASSET_PREFIX, metricsAssetPaths, patchOfficialRequestMetrics } from '../src/officialRequestMetrics.mjs';

import { fixturePrelude, nativeTimingFixture as fixture } from './testkit/officialRequestMetrics.mjs';

async function executableFixture() {
  const patched = patchOfficialRequestMetrics(fixture, '2.5.2'); expect(patched.patched).toBe(true);
  const source = fixturePrelude + patched.text + '\nexport {build,group,main,folded,activity,retry};';
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

describe('native model-step presentation adapter', () => {
  it('enables native boundaries and exposes only exact step identity without desktop or backend debug', () => {
    const result = patchOfficialRequestMetrics(fixture, '2.5.2');
    expect(result.patched).toBe(true);
    expect(result.text).toContain('stepId:A.stepId,state:A.state');
    expect(result.text).toContain('stepId:y.stepId,state:y.state');
    expect(result.text).toContain('stepId:l.stepId,state:l.state');
    expect(result.text).toContain('"data-okw-step-id":O.stepId');
    expect(result.text).toContain('"data-okw-step-id":Lt.stepId');
    expect(result.text).not.toContain('.stepDebug');
    expect(result.text).not.toMatch(/kimiDesktop|debug-endpoints|api\/v1\/debug|localStorage/);
  });
  it.each(['2.4.1', '2.5.3', undefined])('leaves unsupported version %s unmodified', (version) => {
    expect(patchOfficialRequestMetrics(fixture, version)).toEqual({ patched: false, text: fixture });
  });
  it('fails atomically if any contract is missing, duplicated or changed', () => {
    for (const source of [fixture.replace('__name:"StepTimingDebug"', '__name:"ChangedTiming"'),
      fixture.replace('stepDebug||', 'stepDebug&&'), fixture + fixture,
      fixture.replace('"llm-timing":Lt.', '"timing":Lt.')]) {
      expect(patchOfficialRequestMetrics(source, '2.5.2')).toEqual({ patched: false, text: source });
    }
  });
  it('does not rely on minified identifiers or bundle filenames', () => {
    const source = fixture.replace(/\bA\b/g, () => '$step').replace(/\bLt\b/g, () => 'block$1');
    expect(patchOfficialRequestMetrics(source, '2.5.2').patched).toBe(true);
    const implementation = readFileSync(resolve('packages/launcher/src/officialRequestMetrics.mjs'), 'utf8');
    expect(implementation).not.toMatch(/data-v-|CXic|Clt|Alt\(\)|__vue/);
  });
});

describe('native activity timing placement', () => {
  it('preserves one native activity group and attaches each timing to its exact preceding process', async () => {
    const { group, activity, main } = await executableFixture();
    const first = { kind: 'tool', tool: { id: 'a' } }; const second = { kind: 'tool', tool: { id: 'b' } };
    const timing = (id) => ({ kind: 'stepTiming', stepId: id, state: 'completed' });
    const result = group([first, timing('step-a'), second, timing('step-b'), { kind: 'text', text: 'Final reply' },
      timing('step-final')]);
    expect(result.map((row) => row.kind)).toEqual(['activity-run', 'text', 'stepTiming']);
    expect(result[0].items.map((row) => row.okwTimings[0].stepId)).toEqual(['step-a', 'step-b']);
    const rows = activity.default({ item: result[0].items[0] });
    expect(rows[1].props['data-okw-step-id']).toBe('step-a');
    expect(main.default({ item: { kind: 'text' } })).toHaveLength(1);
  });
  it('appends sibling nodes without changing nested component dynamic-property arrays', async () => {
    const { activity, folded, main, retry } = await executableFixture();
    const timing = { stepId: 'thinking-call', state: 'completed' };
    const item = { kind: 'thinking', thinking: 'Fictional reasoning', okwTimings: [timing] };
    for (const slot of [activity, folded, main]) {
      const nodes = slot.default({ item });
      expect(nodes).toHaveLength(2);
      expect(nodes[0].dynamic.every((prop) => typeof prop === 'string')).toBe(true);
      expect(nodes[0].dynamic).not.toContain('data-okw-step-id');
      expect(nodes[1].props['data-okw-step-id']).toBe('thinking-call');
    }
    expect(retry.default()[0].dynamic).toEqual(['tool', 'mobile']);
    const source = patchOfficialRequestMetrics(fixture, '2.5.2').text;
    expect(source.match(/\.\.\.__okwTimingSlots\(/g)).toHaveLength(4);
    expect(source).not.toMatch(/"(?:instant-reveal|duration-ms|mobile)",\.\.\.__okwTimingSlots/);
    const changed = fixture.replace('"items"])):Q("",!0)])', '"items"])):Q("",!1)])');
    expect(patchOfficialRequestMetrics(changed, '2.5.2')).toEqual({ patched: false, text: changed });
  });
  it('does not create orphan rows for steps without a rendered assistant frame', async () => {
    const { build } = await executableFixture(); const rows = [];
    for (const frames of [[], [{ kind: 'thinking', text: '' }], [{ kind: 'text', role: 'assistant', text: '' }],
      [{ kind: 'text', role: 'user', text: 'Fictional injected text' }], [{ kind: 'notice', text: 'Notice' }]]) {
      build({}, { stepId: 'empty', state: 'completed', frames }, rows); expect(rows).toEqual([]);
    }
    build({}, { stepId: 'old', state: 'completed', frames: [{ kind: 'thinking', text: 'Fictional' }] }, rows);
    expect(rows).toHaveLength(1);
  });
  it('does not stack consecutive timing blocks when native duplicate content has been removed', async () => {
    const { group } = await executableFixture();
    const timing = (stepId) => ({ kind: 'stepTiming', stepId, state: 'completed' });
    const tool = group([{ kind: 'tool', tool: { id: 'tool' } }, timing('first'), timing('unrendered')]);
    expect(tool).toHaveLength(1); expect(tool[0].okwTimings.map((item) => item.stepId)).toEqual(['first']);
    const text = group([{ kind: 'text', text: 'Fictional reply' }, timing('first'), timing('unrendered')]);
    expect(text.map((item) => item.kind)).toEqual(['text', 'stepTiming']);
    expect(text[1].stepId).toBe('first');
  });
  it('uses a revisioned namespace for module identity, dependent imports and preloaded assets', () => {
    const html = '<script src="/assets/app.js"></script><link href="/assets/app.css">';
    const source = 'const preload=["assets/a.js"];import("./part.js");new URL("/assets/w.js",import.meta.url)';
    expect(metricsAssetPaths(html, '2.5.2')).toContain(`src="${METRICS_ASSET_PREFIX}/assets/app.js"`);
    expect(metricsAssetPaths(source, '2.5.2')).toContain(`"${METRICS_ASSET_PREFIX.slice(1)}/assets/a.js"`);
    expect(metricsAssetPaths(source, '2.5.2')).toContain('import("./part.js")');
    expect(metricsAssetPaths(html, '2.4.1')).toBe(html);
  });
});
