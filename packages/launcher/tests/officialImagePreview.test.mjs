import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { patchOfficialImagePreview } from '../src/officialImagePreview.mjs';

const source = 'const lightbox={__name:"MediaLightbox"};' +
  'async function resolve(api,media,thumbnail,signal){' +
  'if(thumbnail?.currentSrc&&thumbnail.naturalWidth>0)return{src:thumbnail.currentSrc,w:thumbnail.naturalWidth,' +
  'h:thumbnail.naturalHeight,objectUrl:null};' +
  'let url=media.url,objectUrl=null;if(media.fileId)try{' +
  'const blob=media.sessionId?await api.getSessionMediaBlob(media.sessionId,media.fileId,{signal}):' +
  'await api.getFileBlob(media.fileId,{signal});objectUrl=URL.createObjectURL(blob),url=objectUrl}catch{return null}' +
  'const dimensions=metadata(media)??await probe(url,signal);return dimensions?{src:url,...dimensions,' +
  'objectUrl:objectUrl}:(objectUrl&&URL.revokeObjectURL(objectUrl),null)}';

function setup() {
  const patched = patchOfficialImagePreview(source, '2.7.2');
  expect(patched.patched).toBe(true);
  const probe = vi.fn();
  const metadata = vi.fn((media) => media.dimensions);
  const revokeObjectURL = vi.fn();
  const URL = { createObjectURL: vi.fn(() => 'blob:fixture'), revokeObjectURL };
  const resolve = runInNewContext(patched.text + '\nresolve', { probe, metadata, URL });
  return { resolve, probe, metadata, URL, revokeObjectURL };
}

describe('official image preview dimensions', () => {
  it('uses the actual cropped image instead of the source image metadata', async () => {
    const { resolve, probe, metadata, URL } = setup();
    probe.mockResolvedValue({ w: 605, h: 700 });
    const signal = {};
    const api = { getSessionMediaBlob: vi.fn().mockResolvedValue('image') };
    const media = { fileId: 'fixture', sessionId: 'session', dimensions: { w: 605, h: 1915 } };
    expect(await resolve(api, media, null, signal)).toEqual({
      src: 'blob:fixture', w: 605, h: 700, objectUrl: 'blob:fixture',
    });
    expect(api.getSessionMediaBlob).toHaveBeenCalledWith('session', 'fixture', { signal });
    expect(probe).toHaveBeenCalledWith('blob:fixture', signal);
    expect(metadata).not.toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalledWith('image');
  });

  it('retains metadata as a fallback when image probing fails', async () => {
    const { resolve, probe, metadata } = setup();
    probe.mockResolvedValue(null);
    expect(await resolve({}, { url: 'fixture.png', dimensions: { w: 800, h: 600 } }, null, {}))
      .toEqual({ src: 'fixture.png', w: 800, h: 600, objectUrl: null });
    expect(metadata).toHaveBeenCalledOnce();
  });

  it('uses a loaded thumbnail without issuing another image request', async () => {
    const { resolve, probe } = setup();
    const thumb = { currentSrc: 'blob:thumbnail', naturalWidth: 605, naturalHeight: 700 };
    expect(await resolve({}, {}, thumb, {})).toEqual({ src: 'blob:thumbnail', w: 605, h: 700, objectUrl: null });
    expect(probe).not.toHaveBeenCalled();
  });

  it('revokes the blob when neither probe nor metadata provides dimensions', async () => {
    const { resolve, probe, revokeObjectURL } = setup();
    probe.mockResolvedValue(null);
    expect(await resolve({ getFileBlob: vi.fn().mockResolvedValue('image') }, { fileId: 'fixture' }, null, {})).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fixture');
  });

  it.each([
    [source, '2.7.3'], [source.replace('__name:"MediaLightbox"', '__name:"Other"'), '2.7.2'],
    [source + source, '2.7.2'], [source.replace('metadata(media)??await probe', 'metadata(media)||await probe'), '2.7.2'],
  ])('keeps unknown or ambiguous upstream structures unchanged %#', (input, version) => {
    expect(patchOfficialImagePreview(input, version)).toEqual({ text: input, patched: false });
  });
});
