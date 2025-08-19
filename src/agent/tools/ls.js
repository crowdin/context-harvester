// @ts-check
import fs from 'fs';
import path from 'path';
import { minimatch } from 'minimatch';
import { z } from 'zod';
import { tool } from '@langchain/core/tools';

const MAX_TYPES_TO_DISPLAY = 5;
const MAX_FILES_TO_SCAN = 10000;

function shouldIgnore(p, ignorePatterns) {
  return ignorePatterns.some(pattern => minimatch(p, pattern));
}

function getExtensionPattern(filePath) {
  const ext = path.extname(filePath);
  if (!ext) return '*no-ext';
  return `*${ext}`; // e.g., '*.php'
}

function collectDirectoryStats(dirPath, ignorePatterns) {
  let totalFiles = 0;
  /** @type {Map<string, number>} */
  const extToCount = new Map();

  const stack = [dirPath];
  while (stack.length > 0 && totalFiles < MAX_FILES_TO_SCAN) {
    const current = stack.pop();
    if (!current) break;
    if (shouldIgnore(current, ignorePatterns)) continue;
    let dirents;
    try {
      dirents = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of dirents) {
      const full = path.resolve(current, d.name);
      if (shouldIgnore(full, ignorePatterns)) continue;
      if (d.isDirectory()) {
        stack.push(full);
      } else if (d.isFile()) {
        totalFiles++;
        const extPattern = getExtensionPattern(full);
        extToCount.set(extPattern, (extToCount.get(extPattern) || 0) + 1);
        if (totalFiles >= MAX_FILES_TO_SCAN) break;
      }
    }
  }

  return { totalFiles, extToCount };
}

function formatExtSummary(totalFiles, extToCount) {
  if (totalFiles === 0) return '[0 files in subtree]';
  const items = Array.from(extToCount.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([ext, count]) => `${count} ${ext}`);
  const visible = items.slice(0, MAX_TYPES_TO_DISPLAY);
  const suffix = items.length > visible.length ? ', ...' : '';
  return `[${totalFiles} files in subtree: ${visible.join(', ')}${suffix}]`;
}

export const lsTool = tool(
  input => {
    const listPath = input.path;
    const ignore = input.ignore || [];
    const absRoot = path.resolve(listPath);
    let dirents;
    try {
      dirents = fs.readdirSync(absRoot, { withFileTypes: true });
    } catch (err) {
      return String(err?.message || 'Unable to read directory');
    }

    const entries = dirents
      .map(d => ({ name: d.name, isDir: d.isDirectory(), abs: path.resolve(absRoot, d.name) }))
      .filter(e => !shouldIgnore(e.abs, ignore))
      .sort((a, b) => a.name.localeCompare(b.name));

    const header = absRoot.endsWith(path.sep) ? absRoot : absRoot + path.sep;
    const lines = [header];

    for (const e of entries) {
      const label = e.isDir ? `${e.name}/` : e.name;
      lines.push(`  - ${label}`);
      if (e.isDir) {
        const { totalFiles, extToCount } = collectDirectoryStats(e.abs, ignore);
        lines.push(`    ${formatExtSummary(totalFiles, extToCount)}`);
      }
    }

    return lines.join('\n');
  },
  {
    name: 'ls',
    description: 'List directory entries',
    schema: z.object({
      path: z.string().describe('Directory to list'),
      ignore: z.array(z.string()).optional().describe('Glob patterns to ignore'),
    }),
  },
);
