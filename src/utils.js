//@ts-check
import crowdin from '@crowdin/crowdin-api-client';
import { minimatch } from 'minimatch';

const AI_CONTEXT_SECTION_START = '✨ AI Context';
const AI_CONTEXT_SECTION_END = '✨ 🔚';

// returns a Crowdin API client
// this function looks for the .org property to determine if the client is for crowdin.com or CrowdIn Enterprise
async function getCrowdin(options) {
    //@ts-ignore
    const apiClient = new crowdin.default({
        token: options.token,
        ...(options.org && { organization: options.org }),
    });

    return apiClient;
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
 */
async function uploadAiStringsToCrowdin({ apiClient, project, strings }) {
    const stringsWithAiContext = strings.filter((string) => string?.aiContext?.length > 0);

    const contextUpdateBatchRequest = [];
    for (const string of stringsWithAiContext) {
        contextUpdateBatchRequest.push({
            op: 'replace',
            path: `/${string.id}/context`,
            value: appendAiContext(string.context, string.aiContext),
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

export {
    getCrowdin,
    getCrowdinFiles,
    fetchCrowdinStrings,
    uploadAiStringsToCrowdin,
    getUserId,
    uploadWithoutAiStringsToCrowdin,
    AI_CONTEXT_SECTION_END,
    AI_CONTEXT_SECTION_START,
};