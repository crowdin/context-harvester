//@ts-check
import crowdin from '@crowdin/crowdin-api-client';
import { minimatch } from 'minimatch';
import chalk from "chalk";
import {encoding_for_model} from "tiktoken";
import { createOpenAI } from '@ai-sdk/openai';
import { createVertex } from '@ai-sdk/google-vertex';
import { createAzure } from '@ai-sdk/azure';
import {createAnthropic} from "@ai-sdk/anthropic";
import {createMistral} from "@ai-sdk/mistral";
import {parse} from "csv";
import fs from 'fs';
import {string} from "zod";

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
 * @param {object} param0 
 * @param {object} param0.apiClient
 * @param {number} param0.project
 * @param {string} param0.filesPattern
 */
async function getCrowdinFiles({ apiClient, project, filesPattern }) {
    let files = (await apiClient.sourceFilesApi.withFetchAll().listProjectFiles(project)).data.map(file => file.data);

    // filter out files from the list taht match the glob pattern in files variable
    return files
        .filter((file) =>
            minimatch(file.path, filesPattern || '*', {
                matchBase: true
            })
        )
        .map((file) => (
            {
                id: file.id,
                path: file.path,
            }
        ));
}

/**
 * @param {object} param0 
 * @param {object} param0.apiClient
 * @param {number} param0.project
 * @param {boolean} param0.isStringsProject
 * @param {object} param0.container
 * @param {string} [param0.croql]
 */
async function fetchCrowdinStrings({ apiClient, project, isStringsProject, container, croql }) {
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

    const crowdinStrings = (await apiClient.sourceStringsApi.withFetchAll().listProjectStrings(project, filter)).data.map((string) => string.data);

    const strings = crowdinStrings.map((string) => {
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
        return context.substring(0, aiContextIndex) + aiContextSection + aiContext.join('\n') + endAiContextSection + context.substring(endAiContextIndex + endAiContextSection.length);
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
    };

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
 */
async function uploadAiStringsToCrowdin({ apiClient, project, strings, uploadAll }) {
    const stringsWithAiContext = strings.filter((string) => string?.aiContext?.length > 0 || uploadAll);

    const contextUpdateBatchRequest = [];
    for (const string of stringsWithAiContext) {
        contextUpdateBatchRequest.push({
            op: 'replace',
            path: `/${string.id}/context`,
            value: uploadAll ? string.context : appendAiContext(string.context, string.aiContext),
        });
    }

    await apiClient.sourceStringsApi.stringBatchOperations(project, contextUpdateBatchRequest);
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
        if (!apiClient.aiApi.organization) {    // we're in crowdin.com
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
        'crowdin': ['crowdinAiId'],
        'openai': ['openAiKey'],
        'google-vertex': ['googleVertexProject', 'googleVertexLocation', 'googleVertexClientEmail', 'googleVertexPrivateKey'],
        'azure': ['azureResourceName', 'azureApiKey', 'azureDeploymentName'],
        'anthropic': ['anthropicApiKey'],
        'mistral': ['mistralApiKey'],
    }

    if (!fieldsToProviderMapping[options.ai]) {
        console.error(`error: --ai parameter contains wrong value. Possible values: ${Object.keys(fieldsToProviderMapping)}`);
        process.exit(1);
    }

    let fieldWithError = '';
    if (fieldsToProviderMapping[options.ai].some(variableName => {
        if (!options[variableName]) {
            fieldWithError = variableName;
            return true;
        }
        return false;
    })) {
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
        const parser = fs
          .createReadStream(options.csvFile)
          .pipe(parse({
              columns: true,
          }));
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

    const isStringsProject = (project.type == 1);

    let containers = []; // we call it containers because it can be either files in a regular Crowdin project or branches in a Strings project

    try {
        if (isStringsProject) {
            containers = (await apiClient.sourceFilesApi.withFetchAll().listProjectBranches(options.project)).data.map(branch => branch.data);
        } else {
            if (options.croql) { // because croql filter can't be used with files filter, we create this dummy container as there would no files but we would have strings
                containers = [{
                    id: 0,
                    path: 'croql'
                }]
            } else {
                containers = await getCrowdinFiles({
                    apiClient,
                    project: options.project,
                    filesPattern: options.crowdinFiles
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
                croql: options.croql
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
 * Get tokenizer for model
 *
 * @param providerName
 * @param modelName
 * @returns {Tiktoken}
 */
function getTokenizer(providerName, modelName) {
    try {
        return encoding_for_model(modelName);
    } catch (e) {
        return encoding_for_model('gpt-3.5-turbo');
    }
}

/**
 * Returns the prompt for the AI model, either default or provided by the user
 *
 * @param {object} param0
 * @param {object} param0.options
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
 * Get model context limitations
 *
 * @param {object} param0
 * @param {number} param0.contextWindowSize
 * @param {number} param0.maxOutputTokens
 */
function getModelLimits({ contextWindowSize, maxOutputTokens }) {
    return {
        input: contextWindowSize,
        output: maxOutputTokens
    }
}

/**
 * Chunks strings to fit context window
 * @param {object} param0
 * @param {array} param0.crowdinStrings
 * @param {object} param0.tokenizer
 */

function getStringsChunks({ crowdinStrings, tokenizer, chunkLimit }) {
    const stringsChunks = [];
    let stringsToProceed = [...crowdinStrings];

    while(stringsToProceed.length) {
        let chunk = {};
        for (let string of stringsToProceed) {
            chunk[string.id] = string;
            if (tokenizer.encode(stringifyStrings({ strings: chunk })).length > chunkLimit) {
                delete chunk[string.id];
                break;
            }
        }
        stringsChunks.push(chunk);
        const chunkIds = Object.keys(chunk).map(id => +id);
        stringsToProceed = stringsToProceed.filter(string => !chunkIds.includes(string.id));
    }

    return stringsChunks;
}

/**
 * Stringify strings for AI model
 *
 * @param {object} param0
 * @param {object} param0.strings
 */
function stringifyStrings({ strings}) {
    // string system info like createdAt, updatedAt etc
    const stringsWithoutUselessInfo = Object.keys(strings).reduce((acc, stringKey) => {
        acc[stringKey] = {
            id: strings[stringKey].id,
            text: strings[stringKey].text,
            identifier: strings[stringKey].identifier,
            context: strings[stringKey].context,
        };

        return acc;
    }, {});
    return JSON.stringify(stringsWithoutUselessInfo, null, 2);
}

/**
 * Creates AI client based on user options
 *
 * @param {object} options
 */
function getAiClient(options) {
    if (options.ai === 'openai') {
        return createOpenAI({
            apiKey: options.openAiKey,
        });
    }

    if (options.ai === 'anthropic') {
        return createAnthropic({
            apiKey: options.anthropicApiKey,
        });
    }

    if (options.ai === 'google-vertex') {
        return createVertex({
            project: options.googleVertexProject,
            location: options.googleVertexLocation,
            googleAuthOptions: {
                credentials: {
                    client_email: options.googleVertexClientEmail,
                    private_key: options.googleVertexPrivateKey.replace(/\\n/g, '\n'),
                }
            }
        });
    }

    if (options.ai === 'azure') {
        return createAzure({
            resourceName: options.azureResourceName,
            apiKey: options.azureApiKey,
        });
    }

    if (options.ai === 'mistral') {
        return createMistral({
            apiKey: options.mistralApiKey,
        });
    }

    throw Error('Wrong AI provider selected');
}

export {
    getAiClient,
    getStringsChunks,
    stringifyStrings,
    getPrompt,
    getTokenizer,
    getModelLimits,
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
};
