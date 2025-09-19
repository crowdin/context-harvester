//@ts-check
import crowdin from '@crowdin/crowdin-api-client';
import { minimatch } from 'minimatch';
import chalk from 'chalk';
import { parse } from 'csv';
import fs from 'fs';
import { ChatOpenAI, AzureChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatMistralAI } from '@langchain/mistralai';
import { ChatVertexAI } from '@langchain/google-vertexai';
import * as chrono from 'chrono-node';

const AI_CONTEXT_SECTION_START = '✨ AI Context';
const AI_CONTEXT_SECTION_END = '✨ 🔚';

// returns a Crowdin API client
// this function looks for the .org property to determine if the client is for crowdin.com or CrowdIn Enterprise
async function getCrowdin(options) {
  //@ts-ignore
  const apiClient = new crowdin.default({
    token: options.token,
    ...(options.url && { baseUrl: normalizeUrl(options.url) }),
  });

  return apiClient;
}

/**
 * @param {string} url
 */
function normalizeUrl(url) {
  if (url.endsWith('/')) {
    return `${url}api/v2`;
  } else {
    return `${url}/api/v2`;
  }
}

/**
 * Normalize enterprise base URL: accept either full https://<org>.api.crowdin.com or just <org>
 * @param {string} value
 * @returns {string}
 */
function normalizeEnterpriseUrl(value) {
  if (!value) return value;
  const orgNamePattern = /^[a-z0-9\-]+$/i;
  if (orgNamePattern.test(value)) {
    return `https://${value}.api.crowdin.com`;
  }
  return value;
}

/**
 * Apply environment variable aliases: if canonical var is not set, use the first non-empty alias.
 * @param {Record<string, string[]>} aliasesMap
 */
function applyEnvAliases(aliasesMap) {
  for (const [canonicalName, aliases] of Object.entries(aliasesMap)) {
    const current = process.env[canonicalName];
    if (current !== undefined && String(current).length > 0) continue;
    for (const alias of aliases) {
      const aliasValue = process.env[alias];
      if (aliasValue !== undefined && String(aliasValue).length > 0) {
        process.env[canonicalName] = aliasValue;
        break;
      }
    }
  }
}

/**
 * @param {object} param0
 * @param {object} param0.apiClient
 * @param {number} param0.project
 * @param {string} param0.filesPattern
 */
async function getCrowdinFiles({ apiClient, project, filesPattern }) {
  let files = (await apiClient.sourceFilesApi.withFetchAll().listProjectFiles(project)).data.map(file => file.data);

  // filter out files from the list taht match the glob pattern in files variable
  return files
    .filter(file =>
      minimatch(file.path, filesPattern || '*', {
        matchBase: true,
      }),
    )
    .map(file => ({
      id: file.id,
      path: file.path,
    }));
}

/**
 * @param {object} param0
 * @param {object} param0.apiClient
 * @param {number} param0.project
 * @param {boolean} param0.isStringsProject
 * @param {object} param0.container
 * @param {string} [param0.croql]
 * @param {string} [param0.since]
 */
async function fetchCrowdinStrings({ apiClient, project, isStringsProject, container, croql, since }) {
  const filter = {};

  if (isStringsProject) {
    filter.branchId = container.id;
  } else {
    if (croql) {
      filter.croql = croql;
    } else {
      filter.fileId = container.id;
    }
  }

  let crowdinStrings = (await apiClient.sourceStringsApi.withFetchAll().listProjectStrings(project, filter)).data.map(
    string => string.data,
  );

  const sinceDate = since ? chrono.parseDate(String(since).trim()) : null;

  if (sinceDate) {
    crowdinStrings = crowdinStrings.filter(str => {
      const createdTs = str.createdAt ? Date.parse(str.createdAt) : NaN;
      if (isNaN(createdTs)) return false;
      return createdTs >= sinceDate.getTime();
    });
  }

  const strings = crowdinStrings.map(string => {
    return {
      id: string.id,
      text: string.text,
      key: string.identifier,
    };
  });

  return { crowdinStrings, strings };
}

/**
 * Appends the AI extracted context to the existing context
 *
 * @param {string} context
 * @param {string[]} aiContext
 */
function appendAiContext(context, aiContext) {
  const aiContextSection = `\n\n${AI_CONTEXT_SECTION_START}\n`;
  const endAiContextSection = `\n${AI_CONTEXT_SECTION_END}`;

  const aiContextIndex = context.indexOf(aiContextSection);
  const endAiContextIndex = context.indexOf(endAiContextSection);

  if (aiContextIndex !== -1 && endAiContextIndex !== -1) {
    return (
      context.substring(0, aiContextIndex) +
      aiContextSection +
      aiContext.join('\n') +
      endAiContextSection +
      context.substring(endAiContextIndex + endAiContextSection.length)
    );
  }

  return context + aiContextSection + aiContext.join('\n') + endAiContextSection;
}

/**
 * Remove AI context from the string context
 *
 * @param {string} context
 */
function removeAIContext(context) {
  if (!context) {
    return context;
  }

  const aiContextSection = `\n\n${AI_CONTEXT_SECTION_START}\n`;
  const endAiContextSection = `\n${AI_CONTEXT_SECTION_END}`;

  const aiContextIndex = context?.indexOf(aiContextSection);
  const endAiContextIndex = context?.indexOf(endAiContextSection);

  if (aiContextIndex !== -1 && endAiContextIndex !== -1) {
    return context.substring(0, aiContextIndex) + context.substring(endAiContextIndex + endAiContextSection.length);
  }

  return context;
}

/**
 * Updates strings in Crowdin with the AI extracted context
 *
 * @param {object} param0
 * @param {object} param0.apiClient
 * @param {number} param0.project
 * @param {Array<object>} param0.strings
 * @param {boolean} param0.uploadAll
 * @returns {Promise<number>}
 */
async function uploadAiStringsToCrowdin({ apiClient, project, strings, uploadAll }) {
  const stringsWithAiContext = strings.filter(string => string?.aiContext?.length > 0 || uploadAll);

  const contextUpdateBatchRequest = [];
  for (const string of stringsWithAiContext) {
    contextUpdateBatchRequest.push({
      op: 'replace',
      path: `/${string.id}/context`,
      value: uploadAll ? string.context : appendAiContext(string.context, string.aiContext),
    });
  }

  await apiClient.sourceStringsApi.stringBatchOperations(project, contextUpdateBatchRequest);

  return stringsWithAiContext.length;
}

/**
 * Updates strings in Crowdin without the AI extracted context
 *
 * @param {object} param0
 * @param {object} param0.apiClient
 * @param {number} param0.project
 * @param {Array<object>} param0.strings
 */
async function uploadWithoutAiStringsToCrowdin({ apiClient, project, strings }) {
  const contextUpdateBatchRequest = [];
  for (const string of strings) {
    contextUpdateBatchRequest.push({
      op: 'replace',
      path: `/${string.id}/context`,
      value: removeAIContext(string.context),
    });
  }

  await apiClient.sourceStringsApi.stringBatchOperations(project, contextUpdateBatchRequest);
}

/**
 * Get the user ID for crowdin.com
 *
 * @param {object} apiClient
 */
async function getUserId(apiClient) {
  try {
    if (!apiClient.aiApi.organization) {
      // we're in crowdin.com
      const user = (await apiClient.usersApi.getAuthenticatedUser()).data;
      return user.id;
    }
  } catch (e) {
    console.error('Error: Invalid crowdin.com token');
    process.exit(1);
  }
}

/**
 * Validate required fields for AI providers
 *
 * @param {object} options
 */
function validateAiProviderFields(options) {
  const fieldsToProviderMapping = {
    openai: ['openAiKey'],
    'google-vertex': ['googleVertexProject', 'googleVertexLocation', 'googleVertexClientEmail', 'googleVertexPrivateKey'],
    azure: ['azureResourceName', 'azureApiKey', 'azureDeploymentName'],
    anthropic: ['anthropicApiKey'],
    mistral: ['mistralApiKey'],
  };

  if (!fieldsToProviderMapping[options.ai]) {
    console.error(`error: --ai parameter contains wrong value. Possible values: ${Object.keys(fieldsToProviderMapping)}`);
    process.exit(1);
  }

  let fieldWithError = '';
  if (
    fieldsToProviderMapping[options.ai].some(variableName => {
      if (!options[variableName]) {
        fieldWithError = variableName;
        return true;
      }
      return false;
    })
  ) {
    console.error(`error: --${fieldWithError} is required when using ${options.ai} as AI provider`);
    process.exit(1);
  }
}

/**
 * Load strings from Crowdin

 * @param {object} param0
 * @param {object} param0.apiClient
 * @param {object} param0.spinner
 * @param {object} param0.options
 */
async function getCrowdinStrings({ options, apiClient, spinner }) {
  if (options.append) {
    const records = [];
    const parser = fs.createReadStream(options.csvFile).pipe(
      parse({
        columns: true,
      }),
    );
    for await (const record of parser) {
      record.id = +record.id;
      record.identifier = record.key;
      records.push(record);
    }

    return records;
  }

  spinner.start(`Loading Crowdin data...`);
  let project;
  try {
    project = (await apiClient.projectsGroupsApi.getProject(options.project)).data;
  } catch (error) {
    spinner.fail();
    spinner.fail(`Error: ${error.message}`);
    process.exit(1);
  }

  const isStringsProject = project.type == 1;

  let containers = []; // we call it containers because it can be either files in a regular Crowdin project or branches in a Strings project

  try {
    if (isStringsProject) {
      containers = (await apiClient.sourceFilesApi.withFetchAll().listProjectBranches(options.project)).data.map(branch => branch.data);
    } else {
      if (options.croql) {
        // because croql filter can't be used with files filter, we create this dummy container as there would no files but we would have strings
        containers = [
          {
            id: 0,
            path: 'croql',
          },
        ];
      } else {
        containers = await getCrowdinFiles({
          apiClient,
          project: options.project,
          filesPattern: options.crowdinFiles,
        });
      }
    }
  } catch (error) {
    spinner.fail();
    console.error(`\nError loading Crowdin files: ${error}`);
    process.exit(1);
  }

  spinner.succeed();

  let strings = [];

  // for every branch or file (or one iteration if we are using croql filter)
  for (const container of containers) {
    try {
      spinner.start(`Loading strings from ${chalk.green(container.path || container.name)}`);
      const result = await fetchCrowdinStrings({
        apiClient,
        project: options.project,
        isStringsProject,
        container,
        croql: options.croql,
        since: options.since,
      });
      strings.push(...result.crowdinStrings);
      spinner.succeed();
    } catch (error) {
      spinner.fail();
      console.error(`\nError loading strings from ${container.path || container.name}: ${error}. Proceeding with other files...`);
    }
  }

  return strings;
}

/**
 * Returns the prompt for the AI model, either default or provided by the user
 *
 * @param {object} param0
 * @param {object} param0.options
 * @param {string} param0.defaultPrompt
 */
function getPrompt({ options, defaultPrompt }) {
  let prompt = defaultPrompt;

  if (options.promptFile) {
    try {
      if (options.promptFile === '-') {
        prompt = fs.readFileSync(0, 'utf8');
      } else {
        prompt = fs.readFileSync(options.promptFile, 'utf8');
      }
    } catch (error) {
      console.error(`Error reading prompt file: ${error}`);
      process.exit(1);
    }
  }

  return prompt;
}

/**
 * Stringify strings for AI model
 *
 * @param {object} param0
 * @param {object} param0.string
 */
function stringifyString({ string }) {
  // string system info like createdAt, updatedAt etc
  const stringWithoutUselessInfo = {
    id: string.id,
    text: string.text,
    identifier: string.identifier,
    context: string.context,
  };

  return JSON.stringify(stringWithoutUselessInfo, null, 2);
}

/**
 * Creates a chat model based on the user options
 *
 * @param {object} options
 * @returns {ChatOpenAI | ChatAnthropic | ChatMistralAI | AzureChatOpenAI | ChatVertexAI}
 */
function getChatModel(options) {
  const provider = options.ai;
  const model = options.model;
  if (provider === 'openai') {
    const apiKey = options.openAiKey;
    const baseURL = options.openAiBaseUrl;
    return new ChatOpenAI({ apiKey, model, configuration: baseURL ? { baseURL } : undefined });
  }
  if (provider === 'anthropic') {
    const apiKey = options.anthropicApiKey;
    return new ChatAnthropic({ apiKey, model, streaming: true });
  }
  if (provider === 'mistral') {
    const apiKey = options.mistralApiKey;
    return new ChatMistralAI({ apiKey, model });
  }
  if (provider === 'azure') {
    const azureOpenAIApiKey = options.azureApiKey;
    const azureOpenAIApiInstanceName = options.azureResourceName;
    const azureOpenAIApiDeploymentName = options.azureDeploymentName;
    return new AzureChatOpenAI({
      azureOpenAIApiKey,
      azureOpenAIApiInstanceName,
      azureOpenAIApiDeploymentName,
      azureOpenAIApiVersion: '2023-05-15',
    });
  }
  if (provider === 'google-vertex') {
    const location = options.googleVertexLocation;
    const projectId = options.googleVertexProject;
    const clientEmail = options.googleVertexClientEmail;
    const privateKey = (options.googleVertexPrivateKey || '').replace(/\\n/g, '\n');
    return new ChatVertexAI({
      model,
      location,
      authOptions: {
        projectId,
        credentials: {
          client_email: clientEmail,
          private_key: privateKey,
        },
      },
    });
  }
  throw new Error(`Unsupported ai provider: ${provider}. Supported providers: openai, azure, anthropic, mistral, google-vertex`);
}

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

export {
  stringifyString,
  getPrompt,
  getCrowdinStrings,
  validateAiProviderFields,
  getCrowdin,
  getCrowdinFiles,
  fetchCrowdinStrings,
  uploadAiStringsToCrowdin,
  getUserId,
  uploadWithoutAiStringsToCrowdin,
  AI_CONTEXT_SECTION_END,
  AI_CONTEXT_SECTION_START,
  getChatModel,
  normalizeEnterpriseUrl,
  applyEnvAliases,
  formatTokens,
  formatDuration,
};
