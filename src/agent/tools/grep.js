// @ts-nocheck
import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { spawnSync } from 'child_process';
import { rgPath } from 'vscode-ripgrep';

const DEFAULT_HEAD_LIMIT = 250;
const MAX_HEAD_LIMIT = 250;

export const grepTool = tool(
  input => {
    const args = ['-n', '--heading'];
    if (input['-i']) args.push('-i');
    if (input.multiline) args.push('-U', '--multiline-dotall');
    if (typeof input['-B'] === 'number') args.push(`-B`, String(input['-B']));
    if (typeof input['-A'] === 'number') args.push(`-A`, String(input['-A']));
    if (typeof input['-C'] === 'number') args.push(`-C`, String(input['-C']));
    if (input.type) args.push(`--type`, input.type);
    if (input.glob) args.push(`--glob`, input.glob);
    if (input.output_mode === 'files_with_matches') args.push(`--files-with-matches`);
    if (input.output_mode === 'count') args.push(`--count`);

    args.push(input.pattern);
    if (input.path) args.push(input.path);

    const proc = spawnSync(rgPath, args, { encoding: 'utf8' });
    if (proc.error) {
      return { error: `ripgrep not available: ${proc.error.message}` };
    }
    let output = proc.stdout;
    let lines = output.split('\n');

    const headLimit = input.head_limit || DEFAULT_HEAD_LIMIT;
    const truncated = Math.max(0, lines.length - headLimit);
    const visible = truncated > 0 ? lines.slice(0, headLimit) : lines;

    const result = [...visible];
    if (truncated > 0) {
      result.push('');
      result.push(`... [${truncated} lines truncated] ...`);
    }

    return result.join('\n');
  },
  {
    name: 'grep',
    description: 'Search file contents using ripgrep',
    schema: z.object({
      pattern: z.string().describe('Regex pattern'),
      path: z.string().optional().describe('File or directory to search'),
      glob: z.string().optional().describe('Glob to include files'),
      output_mode: z.enum(['content', 'files_with_matches', 'count']).optional(),
      ['-B']: z.number().optional().describe('Lines before match'),
      ['-A']: z.number().optional().describe('Lines after match'),
      ['-C']: z.number().optional().describe('Lines before/after match'),
      ['-i']: z.boolean().optional().describe('Case-insensitive'),
      type: z.string().optional().describe('File type filter (e.g., js, py)'),
      head_limit: z
        .number()
        .min(1)
        .max(MAX_HEAD_LIMIT)
        .optional()
        .describe(`Limit number of results (default ${DEFAULT_HEAD_LIMIT}, maximum ${MAX_HEAD_LIMIT})`),
      multiline: z.boolean().optional().describe('Enable multiline dotall mode'),
    }),
  },
);
