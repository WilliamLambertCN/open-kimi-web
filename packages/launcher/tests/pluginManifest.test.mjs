// Structural validation of the repo-root Kimi plugin bundle (kimi.plugin.json
// + skills/ + commands/). Importing the upstream manifest parser would make
// this suite depend on a sibling kimi-code checkout, breaking the
// self-contained CI gate — so we re-check the same invariants lightly:
// required fields, "./"-prefixed paths that realpath inside the plugin root,
// and SKILL/command files with valid frontmatter and honest wording.
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PLUGIN_NAME_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const COMMANDS = ['install', 'status', 'repair', 'uninstall'];

const manifest = JSON.parse(readFileSync(join(ROOT, 'kimi.plugin.json'), 'utf8'));
const launcherPkg = JSON.parse(
  readFileSync(join(ROOT, 'packages', 'launcher', 'package.json'), 'utf8'),
);
const skill = readFileSync(join(ROOT, 'skills', 'open-kimi-web', 'SKILL.md'), 'utf8');

/** Extract the leading --- frontmatter block, or null when absent. */
function frontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  return match === null ? null : match[1];
}

/** Mirrors the upstream parser: entries must start with "./" and their
 *  realpath must stay inside the plugin root. */
function expectPluginPath(entry) {
  expect(entry.startsWith('./'), `"${entry}" must start with "./"`).toBe(true);
  const real = realpathSync(resolve(ROOT, entry));
  const rel = relative(realpathSync(ROOT), real);
  const inside = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  expect(inside, `"${entry}" escapes the plugin root`).toBe(true);
}

describe('kimi.plugin.json', () => {
  it('has the required fields, aligned with the launcher package', () => {
    expect(manifest.name).toBe('open-kimi-web');
    expect(manifest.name).toMatch(PLUGIN_NAME_REGEX);
    expect(manifest.version).toBe(launcherPkg.version);
    expect(manifest.license).toBe('MIT');
    expect(manifest.description.trim().length).toBeGreaterThan(0);
    expect(manifest.keywords.length).toBeGreaterThan(0);
    expect(manifest.author).toBeTruthy();
    expect(manifest.homepage).toMatch(/^https:\/\//);
    expect(manifest.interface.displayName).toBeTruthy();
  });

  it('declares only supported extension fields', () => {
    for (const field of ['tools', 'apps', 'inject', 'hooks', 'mcpServers']) {
      expect(manifest[field], `unexpected field "${field}"`).toBeUndefined();
    }
  });

  it('skills/commands entries stay inside the plugin root', () => {
    for (const entry of [...manifest.skills, ...manifest.commands]) {
      expectPluginPath(entry);
      expect(statSync(resolve(ROOT, entry)).isDirectory()).toBe(true);
    }
  });
});

describe('skills/open-kimi-web/SKILL.md', () => {
  it('has valid frontmatter', () => {
    const block = frontmatter(skill);
    expect(block).not.toBeNull();
    expect(block).toMatch(/^name: open-kimi-web$/m);
    expect(block).toMatch(/^description: \|/m);
  });

  it('drives the integrate subcommands and states the env preconditions', () => {
    for (const sub of COMMANDS) {
      expect(skill).toContain(`integrate ${sub}`);
    }
    expect(skill).toContain('node --version');
    expect(skill).toContain('open-kimi-web --version');
  });

  it('documents uninstall-before-remove, without promising auto-restore', () => {
    expect(skill).not.toMatch(/自动恢复/);
    const uninstallAt = skill.indexOf('integrate uninstall');
    const removeAt = skill.indexOf('/plugins remove open-kimi-web');
    expect(uninstallAt).toBeGreaterThan(-1);
    expect(removeAt).toBeGreaterThan(-1);
    expect(uninstallAt).toBeLessThan(removeAt);
  });

  it('keeps the token safety boundary', () => {
    expect(skill).toContain('server.token');
    expect(skill).toMatch(/绝不读取/);
    expect(skill).toContain('指纹');
  });
});

describe('commands/*.md', () => {
  it.each(COMMANDS)('%s.md exists with description frontmatter and matching subcommand', (name) => {
    const text = readFileSync(join(ROOT, 'commands', `${name}.md`), 'utf8');
    const block = frontmatter(text);
    expect(block).not.toBeNull();
    expect(block).toMatch(/^description: \S/m);
    expect(text).toContain(`open-kimi-web integrate ${name}`);
  });

  it('system-modifying commands require explicit user confirmation first', () => {
    for (const name of ['install', 'repair', 'uninstall']) {
      const text = readFileSync(join(ROOT, 'commands', `${name}.md`), 'utf8');
      expect(text, `${name}.md`).toMatch(/确认/);
    }
  });

  it('uninstall.md orders plugin removal after integrate uninstall', () => {
    const text = readFileSync(join(ROOT, 'commands', 'uninstall.md'), 'utf8');
    expect(text.indexOf('integrate uninstall')).toBeLessThan(
      text.indexOf('/plugins remove open-kimi-web'),
    );
  });
});
