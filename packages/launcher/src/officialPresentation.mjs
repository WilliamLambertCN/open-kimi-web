import { readFile } from 'node:fs/promises';
import packageInfo from '../package.json' with { type: 'json' };
import { isBundleVersion } from './officialBundle.mjs';
import { sendResponse } from './responseCompression.mjs';

const PREFIX = '/__open-kimi-mobile/';
const APP_VERSION = packageInfo.version;
const SUBAGENT_SCRIPTS = ['mobileSubagentModelApi.js', 'mobileSubagentModelView.js', 'mobileSubagentModel.js'];
const LOCALE_SCRIPTS = ['locale.js', 'usageLocale.js', 'providerLocale.js'];
const NAVIGATION_SCRIPTS = ['navigationApi.js', 'navigationSearchView.js', 'navigationSearch.js',
  'navigationWorkspace.js', 'navigation.js', 'cronApi.js', 'cronView.js', 'cron.js'];
const PWA_SCRIPTS = ['pwaInstallView.js', 'pwaInstall.js'];
const SESSION_MENU_SCRIPTS = ['sessionActionsApi.js', 'desktopSessionMenu.js', 'mobileSessionMenu.js'];
const TOC_SCRIPTS = ['mobileConversationTocMetadata.js', 'conversationMetadata.js', 'mobileConversationTocNavigate.js',
  'mobileConversationTocView.js', 'mobileConversationToc.js'];
const SIDECHAT_SCRIPTS = ['sideChatModelIdentity.js', 'sideChatModelApi.js', 'sideChatModelView.js', 'sideChatModel.js'];
const METRICS_SCRIPTS = ['requestMetricsModel.js', 'requestMetricsTransport.js',
  'requestMetricsConversation.js', 'requestMetrics.js'];
const RESTART_SCRIPTS = ['serviceRestartView.js', 'serviceRestart.js'];
const FILES = new Map([
  ...RESTART_SCRIPTS.map((name) => [name, 'text/javascript; charset=utf-8']),
  ['serviceRestart.css', 'text/css; charset=utf-8'],
  ...SIDECHAT_SCRIPTS.map((name) => [name, 'text/javascript; charset=utf-8']),
  ['sideChatModel.css', 'text/css; charset=utf-8'],
  ...METRICS_SCRIPTS.map((name) => [name, 'text/javascript; charset=utf-8']),
  ['requestMetrics.css', 'text/css; charset=utf-8'],
  ['branding.js', 'text/javascript; charset=utf-8'],
  ['branding.css', 'text/css; charset=utf-8'],
  ...TOC_SCRIPTS.map((name) => [name, 'text/javascript; charset=utf-8']),
  ['mobileConversationToc.css', 'text/css; charset=utf-8'],
  ...SESSION_MENU_SCRIPTS.map((name) => [name, 'text/javascript; charset=utf-8']),
  ['desktopSessionMenu.css', 'text/css; charset=utf-8'],
  ['mobileSessionMenu.css', 'text/css; charset=utf-8'],
  ...PWA_SCRIPTS.map((name) => [name, 'text/javascript; charset=utf-8']),
  ['pwaInstall.css', 'text/css; charset=utf-8'],
  ['manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['icons/app-192.png', 'image/png'],
  ['icons/app-512.png', 'image/png'],
  ['icons/app-maskable-512.png', 'image/png'],
  ['icons/apple-touch-180.png', 'image/png'],
  ...LOCALE_SCRIPTS.map((name) => [name, 'text/javascript; charset=utf-8']),
  ['effortOrder.js', 'text/javascript; charset=utf-8'],
  ...SUBAGENT_SCRIPTS.map((name) => [name, 'text/javascript; charset=utf-8']),
  ...NAVIGATION_SCRIPTS.map((name) => [name, 'text/javascript; charset=utf-8']),
  ['navigation.css', 'text/css; charset=utf-8'],
  ['cron.css', 'text/css; charset=utf-8'],
  ['mobileSubagentModel.css', 'text/css; charset=utf-8'],
  ['presentation.css', 'text/css; charset=utf-8'],
  ['foldingDefaults.js', 'text/javascript; charset=utf-8'],
  ['workspaceSortDefault.js', 'text/javascript; charset=utf-8'],
  ['mobileWorkspaceSort.js', 'text/javascript; charset=utf-8'],
  ['mobileWorkspaceSort.css', 'text/css; charset=utf-8'],
  ['forkTitleGuard.js', 'text/javascript; charset=utf-8'],
  ['imagePreviewGuard.js', 'text/javascript; charset=utf-8'],
  ['tabFeedback.js', 'text/javascript; charset=utf-8'],
  ['tabFeedback.css', 'text/css; charset=utf-8'],
  ['sideChatScroll.js', 'text/javascript; charset=utf-8'],
  ['notificationPermission.js', 'text/javascript; charset=utf-8'],
  ['completionModal.css', 'text/css; charset=utf-8'],
  ['completionModal.js', 'text/javascript; charset=utf-8'],
  ['questionCardLayout.js', 'text/javascript; charset=utf-8'],
  ['presentation.js', 'text/javascript; charset=utf-8'],
  ['sessionSize.js', 'text/javascript; charset=utf-8'],
  ['sessionSize.css', 'text/css; charset=utf-8'],
  ['messageTimestamps.js', 'text/javascript; charset=utf-8'],
  ['messageTimestamps.css', 'text/css; charset=utf-8'],
  ['chatWidth.css', 'text/css; charset=utf-8'],
  ['archivedSessionDelete.css', 'text/css; charset=utf-8'],
  ['archivedSessionDelete.js', 'text/javascript; charset=utf-8'],
  ['providerSorting.js', 'text/javascript; charset=utf-8'],
  ['providerModelState.js', 'text/javascript; charset=utf-8'],
  ['providerEnhancements.js', 'text/javascript; charset=utf-8'],
  ['workspacePins.css', 'text/css; charset=utf-8'],
  ['workspacePins.js', 'text/javascript; charset=utf-8'],
  ['usage.css', 'text/css; charset=utf-8'],
  ['usageApi.js', 'text/javascript; charset=utf-8'],
  ['usageView.js', 'text/javascript; charset=utf-8'],
  ['usageTrend.js', 'text/javascript; charset=utf-8'],
  ['usageControllers.js', 'text/javascript; charset=utf-8'],
  ['usage.js', 'text/javascript; charset=utf-8'],
  ['usageBundle.js', 'text/javascript; charset=utf-8'],
  ['themes.css', 'text/css; charset=utf-8'],
  ['themes.js', 'text/javascript; charset=utf-8'],
  ['backgrounds/aurora.png', 'image/png'],
  ['backgrounds/twilight.png', 'image/png'],
  ['backgrounds/ember.png', 'image/png'],
  ['backgrounds/mineral.png', 'image/png'],
  ['backgrounds/nocturne.png', 'image/png'],
]);

const USAGE_SCRIPTS = ['usageApi.js', 'usageView.js', 'usageTrend.js', 'usageControllers.js', 'usage.js'];
const SCRIPTS = [
  ...LOCALE_SCRIPTS,
  'effortOrder.js',
  ...SUBAGENT_SCRIPTS,
  ...NAVIGATION_SCRIPTS,
  'foldingDefaults.js',
  'workspaceSortDefault.js',
  'mobileWorkspaceSort.js',
  ...SESSION_MENU_SCRIPTS,
  'forkTitleGuard.js',
  'imagePreviewGuard.js',
  'tabFeedback.js',
  'sideChatScroll.js',
  'notificationPermission.js',
  'completionModal.js',
  'themes.js',
  'providerSorting.js',
  'providerModelState.js',
  'providerEnhancements.js',
  'workspacePins.js',
  'archivedSessionDelete.js',
  'usageBundle.js',
  ...PWA_SCRIPTS,
  'questionCardLayout.js',
  'presentation.js',
  'sessionSize.js',
  'messageTimestamps.js',
  ...TOC_SCRIPTS,
  ...SIDECHAT_SCRIPTS,
  ...METRICS_SCRIPTS,
  ...RESTART_SCRIPTS,
  'branding.js',
];
const STYLES = [
  'presentation.css',
  'themes.css',
  'branding.css',
  'navigation.css',
  'pwaInstall.css',
  'cron.css',
  'mobileWorkspaceSort.css',
  'desktopSessionMenu.css',
  'mobileSessionMenu.css',
  'mobileSubagentModel.css',
  'workspacePins.css',
  'archivedSessionDelete.css',
  'completionModal.css',
  'usage.css',
  'tabFeedback.css',
  'sessionSize.css',
  'messageTimestamps.css',
  'requestMetrics.css',
  'sideChatModel.css',
  'serviceRestart.css',
  'chatWidth.css',
  'mobileConversationToc.css',
];

// Serve the presentation layer from the installed launcher, so existing
// official caches receive updates without rewriting upstream assets.
export async function servePresentationAsset(req, res) {
  const pathname = (req.url ?? '/').split('?')[0];
  if (!pathname.startsWith(PREFIX)) return false;
  const name = pathname.slice(PREFIX.length);
  const type = FILES.get(name);
  if (!type) {
    res.writeHead(404).end('Not Found');
    return true;
  }
  const body = name === 'usageBundle.js'
    ? Buffer.from((await Promise.all(USAGE_SCRIPTS.map((script) =>
      readFile(new URL(`./mobile/${script}`, import.meta.url))))).join('\n'))
    : await readFile(new URL(`./mobile/${name}`, import.meta.url));
  await sendResponse(req, res, {
    headers: {
      'content-type': type,
      'content-length': body.length,
      'cache-control': 'no-cache',
    },
    body,
  });
  return true;
}

function hasNativeSideChatScroll(version) {
  if (!isBundleVersion(version)) return false;
  const [release, prerelease] = version.split('+')[0].split('-');
  const [major, minor, patch] = release.split('.').map(Number);
  if (major !== 2) return major > 2;
  if (minor !== 3) return minor > 3;
  return patch > 0 || prerelease === undefined;
}

export function addMobilePresentation(html, { officialWebVersion, requestMetricsState } = {}) {
  const conversation = ['2.6.0', '2.6.1'].includes(officialWebVersion);
  const excluded = new Set([conversation ? 'mobileConversationTocMetadata.js' : 'conversationMetadata.js']);
  if (hasNativeSideChatScroll(officialWebVersion)) excluded.add('sideChatScroll.js');
  if (conversation) excluded.add('foldingDefaults.js');
  const scriptNames = SCRIPTS.filter((name) => !excluded.has(name));
  const metricsMeta = ['active', 'incompatible-bundle', 'unavailable-bundle'].includes(requestMetricsState)
    ? `<meta name="open-kimi-web-request-metrics" content="${requestMetricsState}">\n` : '';
  const metadata = `<meta name="open-kimi-web-version" content="${APP_VERSION}">\n` + metricsMeta;
  const scripts = metadata + scriptNames.map((name) => `<script src="${PREFIX}${name}"></script>`).join('\n') + '\n';
  const original = html.replace(/<link\b(?=[^>]*\brel\s*=\s*["'](?:shortcut\s+)?icon["'])[^>]*>\s*/gi, '');
  const moduleTag = /<script\b[^>]*\btype\s*=\s*["']module["'][^>]*>/i;
  const withScript = moduleTag.test(original)
    ? original.replace(moduleTag, (tag) => `${scripts}${tag}`)
    : original.replace('</head>', `${scripts}</head>`);
  const styles = STYLES.map((name) => `<link rel="stylesheet" href="${PREFIX}${name}">`).join('\n') + '\n';
  const install = [
    `<link rel="icon" type="image/png" sizes="192x192" href="${PREFIX}icons/app-192.png">`,
    `<link rel="manifest" href="${PREFIX}manifest.webmanifest">`,
    `<link rel="apple-touch-icon" sizes="180x180" href="${PREFIX}icons/apple-touch-180.png">`,
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-title" content="Open Kimi Web">',
  ].join('\n') + '\n';
  return withScript.replace('</head>', `${styles}${install}</head>`);
}
