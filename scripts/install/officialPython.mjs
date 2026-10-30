import { constants } from 'node:fs';
import { access, open, realpath } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { pathStat } from './npm.mjs';

const UV_MAIN = 'import sys\nfrom kimi_cli.__main__ import main\nif __name__ == "__main__":\n' +
  '    if sys.argv[0].endswith("-script.pyw"):\n        sys.argv[0] = sys.argv[0][:-11]\n' +
  '    elif sys.argv[0].endswith(".exe"):\n        sys.argv[0] = sys.argv[0][:-4]\n    sys.exit(main())\n';
const PIP_MAIN = "import re\nimport sys\nfrom kimi_cli.__main__ import main\nif __name__ == '__main__':\n" +
  "    sys.argv[0] = re.sub(r'(-script\\.pyw|\\.exe)?$', '', sys.argv[0])\n    sys.exit(main())\n";
const SIMPLE_MAIN = 'import sys\nfrom kimi_cli.__main__ import main\nif __name__ == "__main__":\n    sys.exit(main())\n';

async function assertInterpreter(interpreter) {
  try {
    const target = await realpath(interpreter);
    if (!(await pathStat(target))?.isFile()) throw new Error();
    await access(target, constants.X_OK);
    const handle = await open(target, 'r');
    const bytes = Buffer.alloc(4);
    try { await handle.read(bytes, 0, 4, 0); } finally { await handle.close(); }
    if (!['7f454c46', 'feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca'].includes(bytes.toString('hex'))) {
      throw new Error();
    }
  } catch {
    throw new Error('official Python console entry interpreter is missing, non-executable or unsupported; ' +
      'repair its environment');
  }
}

async function readConsole(target) {
  const stat = await pathStat(target);
  if (!stat?.isFile() || stat.size > 4096) return '';
  const handle = await open(target, 'r');
  const buffer = Buffer.alloc(4097);
  let bytesRead;
  try { ({ bytesRead } = await handle.read(buffer, 0, buffer.length, 0)); } finally { await handle.close(); }
  return bytesRead > 4096 ? '' : buffer.subarray(0, bytesRead).toString('utf8');
}

export async function pythonConsoleEntry(target) {
  const text = await readConsole(target);
  const newline = text.indexOf('\n');
  if (!text.startsWith('#!') || newline < 0) return false;
  const interpreter = text.slice(2, newline);
  if (!isAbsolute(interpreter) || /[\s\0]/.test(interpreter) || !/^python(?:\d+(?:\.\d+)*)?$/.test(basename(interpreter))) {
    return false;
  }
  const body = text.slice(newline + 1).replace(/^# -\*- coding: utf-8 -\*-\n/, '');
  const templates = [UV_MAIN, PIP_MAIN, SIMPLE_MAIN];
  const supported = templates.some((template) => [template,
    template.replace('from kimi_cli.__main__ import main', 'from kimi_cli.cli import cli')
      .replace('sys.exit(main())', 'sys.exit(cli())'),
  ].includes(body));
  if (!supported) return false;
  await assertInterpreter(interpreter);
  return true;
}
