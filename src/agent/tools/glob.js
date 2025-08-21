// @ts-nocheck
import { globIterate } from 'glob';
import path from 'path';
import { z } from 'zod';
import { tool } from '@langchain/core/tools';

const DISPLAY_LIMIT = 100;
const SEARCH_LIMIT = 10000;

export const globTool = tool(
  async input => {
    const baseDir = input.target_directory || process.cwd();
    const pattern = input.glob_pattern;
    // Return relative paths (to baseDir) and include dotfiles. Use iterator to allow early stopping.
    const iterOptions = { cwd: baseDir, absolute: false, dot: true, ignore: [] };
    const matches = [];
    let scannedCount = 0;

    // Manual iteration to detect if there are more than SEARCH_LIMIT results
    const iterator = globIterate(pattern, iterOptions)[Symbol.asyncIterator]();
    while (scannedCount < SEARCH_LIMIT) {
      const { value, done } = await iterator.next();
      if (done) break;
      matches.push(value);
      scannedCount++;
    }

    // Sort the collected set and only display the first DISPLAY_LIMIT
    matches.sort((a, b) => a.localeCompare(b));
    const visibleMatches = matches.slice(0, DISPLAY_LIMIT);

    const baseAbs = path.resolve(baseDir);
    const cwdAbs = process.cwd();
    const relBase = path.relative(cwdAbs, baseAbs);
    const headerDirLabel = relBase ? `./${relBase}` : '.';

    const lines = [`Result of search in '${headerDirLabel}':`, ...visibleMatches.map(p => (relBase ? `- ${relBase}/${p}` : `- ${p}`))];

    const additionalCount = Math.max(0, scannedCount - visibleMatches.length);
    if (additionalCount > 0) {
      lines.push(`... at least ${additionalCount} more files ... (Do a more specific search if needed)`);
    }

    return lines.join('\n');
  },
  {
    name: 'glob',
    description: 'Find files by glob pattern',
    schema: z.object({
      target_directory: z.string().optional().describe('Directory to search (defaults to workspace root)'),
      glob_pattern: z.string().describe('Glob pattern (e.g., "**/*.js")'),
    }),
  },
);
