// @ts-nocheck
import ora from 'ora';
import chalk from 'chalk';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { isToolMessage } from '@langchain/core/messages';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { globTool, grepTool, lsTool, readTool } from './agent/tools/index.js';
import { SYSTEM_PROMPT } from './agent/prompts/system.js';
import { getCrowdin, getPrompt, validateAiProviderFields, formatDuration, getChatModel } from './utils.js';

const spinner = ora();

const DEFAULT_USER_PROMPT = `You are generating a translator-oriented description by analyzing the local project.

Goals:
- Help translators quickly understand what this project is about and how to translate it safely and consistently.
- Prefer concrete facts found in code, configurations, and scripts; if uncertain, omit.
- Do not reference specific string keys/texts or file paths; keep the description general and product-level.

Deliverable:
- One cohesive description in plain prose (6–12 sentences, 1–2 short paragraphs). No lists, no headings, no bullet points.

Cover, when evident from the project, in natural prose:
- What the project does, who uses it, and its main features/workflows at a high level.
- Tech stack and any i18n-relevant libraries/frameworks (e.g., ICU, i18next, formatjs), only if clearly present.
- Placeholders/formatting that translators must preserve: variable tokens (e.g., {{name}}, %s), HTML/Markdown, ICU MessageFormat, dates/numbers.
- Plurals/gender, capitalization, punctuation, length/space constraints, or RTL/localization specifics if applicable.
- Tone/voice and terminology cues; mention product/brand names and items that must not be translated.
- Any configuration/run details that help understand where user-facing text originates (keep high-level).

When ready, call the return_description tool with the final text.`;

const returnDescriptionTool = tool(
  input => {
    return typeof input?.description === 'string' ? input.description.trim() : '';
  },
  {
    name: 'return_description',
    description: 'Return the final project description text.',
    schema: z.object({
      description: z.string().describe('Project description text'),
    }),
    returnDirect: true,
  },
);

async function invokeAgent({ agent, prompt }) {
  const result = await agent.invoke(prompt, { recursionLimit: 200 });
  const lastMessage = result.messages[result.messages.length - 1];
  const tokensUsed = result.messages.reduce((totalTokens, message) => totalTokens + (message.usage_metadata?.total_tokens ?? 0), 0);

  if (!lastMessage || !isToolMessage(lastMessage) || lastMessage.name !== 'return_description' || lastMessage.content.length === 0) {
    return { description: null, tokensUsed };
  }

  return { description: lastMessage.content, tokensUsed };
}

function createAgentAndPrompt(options) {
  const llm = getChatModel(options);
  const agent = createReactAgent({ llm, tools: [globTool, grepTool, lsTool, readTool, returnDescriptionTool] });
  const promptTemplate = ChatPromptTemplate.fromMessages([
    ['system', SYSTEM_PROMPT],
    ['user', getPrompt({ options, defaultPrompt: DEFAULT_USER_PROMPT })],
  ]);
  return { agent, promptTemplate };
}

async function describeProject(_name, commandOptions, _command) {
  const startedAt = Date.now();
  try {
    const options = commandOptions.opts();

    if (!['terminal', 'crowdin'].includes(options.output)) {
      console.error('Wrong value provided for --output option. terminal and crowdin values are available.');
      process.exit(1);
    }

    validateAiProviderFields(options);

    const apiClient = await getCrowdin(options);

    spinner.start('Generating project description...');
    const { agent, promptTemplate } = createAgentAndPrompt(options);
    const prompt = await promptTemplate.invoke({
      model: options.model,
      working_dir: process.cwd(),
      date: new Date().toISOString(),
    });
    const { description } = await invokeAgent({ agent, prompt });
    spinner.succeed();

    if (!description || description.trim().length === 0) {
      console.error('No description was generated.');
      process.exit(1);
    }

    if (options.output === 'terminal') {
      console.log('\n');
      console.log(chalk.bold('Project Description:\n'));
      console.log(description);
    } else if (options.output === 'crowdin') {
      spinner.start('Updating Crowdin project description...');
      await apiClient.projectsGroupsApi.editProject(options.project, [{ op: 'replace', path: '/description', value: description }]);
      spinner.succeed();
    }
  } catch (error) {
    console.error('error:', error);
  } finally {
    const elapsedMs = Date.now() - startedAt;
    console.log(`\nTotal execution time: ${chalk.green(formatDuration(elapsedMs))}\n`);
  }
}

export default describeProject;
