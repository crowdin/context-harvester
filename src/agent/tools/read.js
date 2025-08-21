// @ts-check
import fs from 'fs';
import { z } from 'zod';
import { tool } from '@langchain/core/tools';

const DEFAULT_LIMIT = 250;
const MAX_LIMIT = 750;

export const readTool = tool(
  input => {
    const filePath = input.path;
    const content = fs.readFileSync(filePath, 'utf8');
    const allLines = content.split(/\r?\n/);

    const total = allLines.length;
    const startLine = Math.max(1, typeof input.offset === 'number' ? input.offset : 1);
    const endLine = Math.min(total, startLine + (input.limit || DEFAULT_LIMIT) - 1);

    const padWidth = Math.max(6, String(total).length);
    const result = [];

    if (startLine > 1) {
      result.push(`... ${startLine - 1} lines not shown ...`);
    }

    for (let i = startLine; i <= endLine; i++) {
      const num = String(i).padStart(padWidth, ' ');
      result.push(`${num}|${allLines[i - 1]}`);
    }

    if (endLine < total) {
      result.push(`... ${total - endLine} lines not shown ...`);
    }

    return result.join('\n');
  },
  {
    name: 'read',
    description: 'Read file contents',
    schema: z.object({
      path: z.string().describe('File path to read'),
      offset: z.number().min(1).optional().describe('Line number to start from'),
      limit: z
        .number()
        .min(1)
        .max(MAX_LIMIT)
        .optional()
        .describe(`Number of lines to read (default ${DEFAULT_LIMIT}, maximum ${MAX_LIMIT})`),
    }),
  },
);
