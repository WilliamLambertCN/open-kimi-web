import { describe, expect, it } from 'vitest';
import { addMobilePresentation } from '../src/officialPresentation.mjs';

const html = '<html><head><script type="module" src="/assets/index.js"></script></head></html>';
const prefix = '/__open-kimi-mobile/';
describe('conversation presentation resource boundary', () => {
  it.each(['2.6.0', '2.6.1'])('selects %s conversation resources before boot without rewriting folding', (version) => {
    const text = addMobilePresentation(html, { officialWebVersion: version });
    expect(text).toContain(prefix + 'conversationMetadata.js');
    for (const old of ['mobileConversationTocMetadata.js', 'foldingDefaults.js', 'sideChatScroll.js']) {
      expect(text).not.toContain(prefix + old);
    }
    expect(text.indexOf('conversationMetadata.js')).toBeLessThan(text.indexOf('mobileConversationToc.js'));
    expect(text.indexOf('mobileConversationToc.js')).toBeLessThan(text.indexOf('<script type="module"'));
    for (const different of ['imagePreviewGuard.js', 'notificationPermission.js', 'messageTimestamps.js']) {
      expect(text).toContain(prefix + different);
    }
  });
  it.each(['2.3.1', '2.4.1', '2.5.2', '2.6.2', '2.6.1-rc.1', undefined])('preserves legacy resources for %s', (version) => {
    const text = addMobilePresentation(html, { officialWebVersion: version });
    expect(text).not.toContain(prefix + 'conversationMetadata.js');
    expect(text).toContain(prefix + 'mobileConversationTocMetadata.js');
    expect(text).toContain(prefix + 'foldingDefaults.js');
  });
});
