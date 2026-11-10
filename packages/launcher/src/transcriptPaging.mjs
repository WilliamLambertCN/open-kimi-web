const SUPPORTED_VERSIONS = new Set(['2.3.1', '2.4.1', '2.5.2']);
const INITIAL_MAIN_TRANSCRIPT = new RegExp(
  '^/api/v1/sessions/[A-Za-z0-9_-]+/transcript\\?(?:agent_id=main&page_size=10|page_size=10&agent_id=main)(?![\\s\\S])',
);

export function supportsTranscriptPaging({ officialPresentation, officialWebVersion }) {
  return officialPresentation === true && SUPPORTED_VERSIONS.has(officialWebVersion);
}

export function transcriptProxyPath(req, context) {
  if (!supportsTranscriptPaging(context)) return req.url;
  if (req.method !== 'GET' || req.headers.range !== undefined) return req.url;
  if (!INITIAL_MAIN_TRANSCRIPT.test(req.url)) return req.url;
  return req.url.replace('page_size=10', 'page_size=1');
}
