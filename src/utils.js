import crowdin from '@crowdin/crowdin-api-client';
import { minimatch } from 'minimatch';

// returns a Crowdin API client
// this function looks for the .org property to determine if the client is for crowdin.com or CrowdIn Enterprise
async function getCrowdin(options) {
    const apiClient = new crowdin.default({
        token: options.token,
        ...(options.org && { organization: options.org }),
    });

    try {
        if (!options.org) {
            const user = (await apiClient.usersApi.getAuthenticatedUser()).data;
            apiClient.userId = user.id; //NOTE: this is probably not nice
        }
    } catch (e) {
        console.error('Error: Invalid Crowdin token');
        process.exit(1);
    }

    apiClient.isEnterprise = !!options.org;

    return apiClient;
}

async function getCrowdinFiles(apiClient, project, filesPattern) {
    let files = (await apiClient.sourceFilesApi.withFetchAll().listProjectFiles(project)).data.map(file => file.data);

    // filter out files from the list taht match the glob pattern in files variable
    return files.filter((file) => {
        return minimatch(file.path, filesPattern || '*', {
            matchBase: true
        });
    }).map((file) => {
        return {
            id: file.id,
            path: file.path,
        };
    });
}

async function fetchCrowdinStrings(apiClient, project, isStringsProject, container, strings, croql) {
    let filter = {};

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

    // merge the strings from the file or branch with the global strings array
    strings.push(...crowdinStrings);

    return crowdinStrings.map((string) => {
        return {
            id: string.id,
            text: string.text,
            key: string.identifier,
        };
    });
}

// appends the AI extracted context to the existing context
function appendAiContext(context, aiContext) {
    const aiContextSection = '\n\n✨ AI Context\n';
    const endAiContextSection = '\n✨ 🔚';

    const aiContextIndex = context.indexOf(aiContextSection);
    const endAiContextIndex = context.indexOf(endAiContextSection);

    if (aiContextIndex !== -1 && endAiContextIndex !== -1) {
        return context.substring(0, aiContextIndex) + aiContextSection + aiContext.join('\n') + endAiContextSection + context.substring(endAiContextIndex + endAiContextSection.length);
    }

    return context + aiContextSection + aiContext.join('\n') + endAiContextSection;
}

// updates strings in Crowdin with the AI extracted context
async function uploadAiStringsToCrowdin(apiClient, project, strings) {
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

export {
    getCrowdin,
    getCrowdinFiles,
    fetchCrowdinStrings,
    uploadAiStringsToCrowdin,
};