// @ts-nocheck
import chalk from 'chalk';
import cliWidth from 'cli-width';
import fs from 'fs';
import path from 'path';
import { Parser } from 'json2csv';
import ora from 'ora';
import { table } from 'table';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { HumanMessage, SystemMessage, isToolMessage } from '@langchain/core/messages';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import cliProgress from 'cli-progress';
import {
  getCrowdin,
  uploadAiStringsToCrowdin,
  validateAiProviderFields,
  getCrowdinStrings,
  getPrompt,
  stringifyString,
  getChatModel,
} from './utils.js';
import { SYSTEM_PROMPT } from './agent/prompts/system.js';
import { globTool, grepTool, lsTool, readTool } from './agent/tools/index.js';

const DEFAULT_USER_PROMPT = `Please, extract the context from the code for the following string.

- Context is useful information for linguists or an AI translating these texts about how the text is used in the project they are localizing or when it appears in the UI.
- Provide context for string only if exact match of the string's text or string's key are found in the code.
- To set context for string call the return_context tool.

String:
{string}`;

const returnContextTool = tool(
  input => {
    return typeof input?.context === 'string' ? input.context.trim() : '';
  },
  {
    name: 'return_context',
    description: 'Return context text for the current string.',
    schema: z.object({
      context: z.string().optional().describe('Context text'),
    }),
    returnDirect: true,
  },
);

const spinner = ora();

function formatTokens(count) {
  const n = Number(count) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(2) + 'k';
  return String(n);
}

function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

async function invokeAgent({ agent, prompt }) {
  const result = await agent.invoke(prompt, { recursionLimit: 100 });
  const lastMessage = result.messages[result.messages.length - 1];
  const tokensUsed = result.messages.reduce((totalTokens, message) => totalTokens + (message.usage_metadata?.total_tokens ?? 0), 0);

  if (!lastMessage || !isToolMessage(lastMessage) || lastMessage.name !== 'return_context' || lastMessage.content.length === 0) {
    return { context: null, tokensUsed };
  }

  return { context: lastMessage.content, tokensUsed };
}

function createAgentAndPrompt(options) {
  const llm = getChatModel(options);
  const agent = createReactAgent({ llm, tools: [globTool, grepTool, lsTool, readTool, returnContextTool] });
  const promptTemplate = ChatPromptTemplate.fromMessages([
    ['system', SYSTEM_PROMPT],
    ['user', getPrompt({ options, defaultPrompt: DEFAULT_USER_PROMPT })],
  ]);
  return { agent, promptTemplate };
}

function createProgressBar() {
  const bar = new cliProgress.SingleBar(
    { format: 'Processed strings {value}/{total} | {bar} {percentage}% | {tokens} tokens' },
    cliProgress.Presets.shades_classic,
  );
  return bar;
}

async function processSingleString({ agent, promptTemplate, workingDir, options, string }) {
  try {
    const prompt = await promptTemplate.invoke({
      model: options.model,
      working_dir: workingDir,
      date: new Date().toISOString(),
      string: stringifyString({ string }),
    });
    const { context, tokensUsed } = await invokeAgent({ agent, prompt });
    return { id: string.id, context, tokensUsed };
  } catch (err) {
    console.log(`\nError during processing string: ${err.message}`);
    return { id: string.id, context: null, tokensUsed: 0 };
  }
}

async function runConcurrentWorkers({ items, concurrency, worker }) {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      if (cursor >= items.length) return;
      const currentIndex = cursor++;
      await worker(items[currentIndex]);
    }
  });
  await Promise.all(workers);
}

async function extractContexts({ strings, options }) {
  const concurrency = Number(options.concurrency);
  const workingDir = process.cwd();
  let totalTokensUsed = 0;
  const bar = createProgressBar();
  const { agent, promptTemplate } = createAgentAndPrompt(options);

  const results = [];
  const total = strings.length;
  bar.start(total, 0, { tokens: formatTokens(0) });

  await runConcurrentWorkers({
    items: strings,
    concurrency,
    worker: async s => {
      const { id, context, tokensUsed } = await processSingleString({ agent, promptTemplate, workingDir, options, string: s });
      totalTokensUsed += tokensUsed || 0;
      if (context) results.push({ id, context });
      bar.increment(1, { tokens: formatTokens(totalTokensUsed) });
    },
  });

  bar.stop();
  return { contexts: results };
}

/**
 * Prints the strings that would be updated in a dry run
 *
 * @param {Array<object>} strings
 */
function dryRunPrint(strings) {
  const stringsWithAiContext = strings.filter(string => string.aiContext);

  const terminalWidth = cliWidth();

  // Calculate the width for each column
  const idColumnWidth = Math.floor(terminalWidth * 0.15);
  const textColumnWidth = Math.floor(terminalWidth * 0.35);
  const contextColumnWidth = Math.floor(terminalWidth * 0.45);

  const config = {
    header: {
      alignment: 'center',
      content: 'Strings with AI Context',
    },
    columns: [
      {
        width: idColumnWidth,
        wrapWord: true,
      },
      {
        width: textColumnWidth,
        wrapWord: true,
      },
      {
        width: contextColumnWidth,
        wrapWord: true,
      },
    ],
  };

  let data = [];
  for (const string of stringsWithAiContext) {
    data.push([string.identifier, string.text, string.aiContext.join('\n')]);
  }

  if (data.length < 1) {
    console.log(`\nNo context found for any strings.`);
    return;
  }

  console.log('\n');
  //@ts-ignore
  console.log(table(data, config));

  console.log(
    `\n${stringsWithAiContext.length} strings would be updated. Please be aware that an LLM model may return different results for the same input next time you run the tool.`,
  );
}

/**
 * Writes the strings with AI context to a CSV file
 *
 * @param {object} options
 * @param {Array<object>} strings
 */
function writeCsv(options, strings) {
  const csvFile = options.csvFile;

  const stringsWithAiContext = strings.filter(string => string.aiContext);

  const data = stringsWithAiContext.map(string => {
    return {
      id: string.id,
      key: string.identifier,
      text: string.text,
      context: string.context,
      aiContext: string.aiContext.join('\n'),
    };
  });

  if (data.length < 1) {
    console.log(`\nNo context found for any strings.`);
    return;
  }

  try {
    const parser = new Parser({ fields: ['id', 'key', 'text', 'context', 'aiContext'] });
    const csv = parser.parse(data);

    fs.writeFileSync(csvFile, csv);
    console.log(`\n${data.length} strings saved to ${chalk.green(csvFile)}`);
  } catch (err) {
    console.error(`Error writing CSV file: ${err}`);
  }
}

/**
 * This function runs at the end of the context extraction process
 * it goes through all extracted contexts, compile an array of contexts for every string
 * if user wanted to confirm the context, it will ask for confirmation
 *
 * @param {Array<object>} strings
 * @param {object} [stringsContext]
 */
async function appendContext(strings, stringsContext) {
  for (const context of stringsContext?.contexts || []) {
    const string = strings.find(s => s.id === context.id);

    if (string && context?.context) {
      if (!string.aiContext) {
        string.aiContext = [];
      }

      string.aiContext.push(context.context);
    }
  }
}

// main function that orchestrates the context extraction process
async function harvest(_name, commandOptions, _command) {
  const startedAt = Date.now();
  try {
    const options = commandOptions.opts();

    if (options.append) {
      if (options.output !== 'csv') {
        console.error(`--append can't be used when --output is not equal to "csv"`);
        process.exit(1);
      }
      if (!fs.existsSync(options.csvFile)) {
        console.error(`CSV file doesn't exist, can't run with --append option`);
        process.exit(1);
      }
    }

    if (!['terminal', 'csv', 'crowdin'].includes(options.output)) {
      console.error('Wrong value provided for --output option. terminal, csv and crowdin values are available.');
      process.exit();
    }

    validateAiProviderFields(options);

    const apiClient = await getCrowdin(options);

    const strings = await getCrowdinStrings({
      spinner,
      options,
      apiClient,
    });

    let stringsContext = {};

    try {
      stringsContext = await extractContexts({ strings, options });
    } catch (e) {
      console.log('\nError during context extraction');
      console.error(e);
    }

    try {
      await appendContext(strings, stringsContext);
    } catch (error) {
      console.log('\nError during context appending');
      console.error(error);
    }

    if (options.output === 'terminal') {
      dryRunPrint(strings);
    } else if (options.output === 'csv') {
      writeCsv(options, strings);
    } else if (options.output === 'crowdin') {
      spinner.start(`Updating Crowdin strings...`);
      await uploadAiStringsToCrowdin({
        apiClient,
        project: options.project,
        strings,
      });
      spinner.succeed();
    }
  } catch (error) {
    console.error('error:', error);
  } finally {
    const elapsedMs = Date.now() - startedAt;
    console.log(`\nTotal execution time: ${chalk.green(formatDuration(elapsedMs))}\n`);
  }
}

export default harvest;
