import ora from 'ora';
import { getCrowdin, getCrowdinFiles, fetchCrowdinStrings } from './utils.js';

const spinner = ora();

async function reset(name, commandOptions, command) {
    const options = commandOptions.opts();

    const apiClient = await getCrowdin(options);

    spinner.start(`Loading Crowdin data...`);

    let project;
    try {
        project = (await apiClient.projectsGroupsApi.getProject(options.project)).data;
    } catch (error) {
        spinner.fail();
        console.error(`Project with ID ${options.project} not found or cannot be accessed.`);
        process.exit(1);
    }

    const isStringsProject = (project.type == 1);

    let containers = []; // branches or files

    try {
        if (isStringsProject) {
            containers = (await apiClient.sourceFilesApi.withFetchAll().listProjectBranches(options.project)).data.map(branch => branch.data);
        } else {
            containers = await getCrowdinFiles(apiClient, options.project, options.crowdinFiles);
        }
    } catch (error) {
        spinner.fail();
        console.error(`Error loading Crowdin files: ${error}`);
        process.exit(1);
    }

    let strings = [];
    for (const container of containers) {
        spinner.start(`Removing AI context from ${container.path || container.name}...`);
        try {
            await fetchCrowdinStrings(apiClient, options.project, isStringsProject, container, strings);
        } catch (error) {
            spinner.fail();
            console.error(`Error loading strings from ${container.path || container.name}: ${error}. Proceeding with other files...`);
            continue;
        }

        strings = strings.filter((string) => {
            return string.context.indexOf('✨ AI Context') !== -1;
        });

        try {
            updateStrings(apiClient, options.project, strings);
        } catch (error) {
            spinner.fail();
            console.error(`Error updating strings: ${error}`);
            process.exit(1);
        }

        spinner.succeed();
    }
}

async function updateStrings(apiClient, project, strings) {
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

// Remove AI context from the string context
function removeAIContext(context) {
    const aiContextSection = '\n\n✨ AI Context\n';
    const endAiContextSection = '\n✨ 🔚';

    const aiContextIndex = context.indexOf(aiContextSection);
    const endAiContextIndex = context.indexOf(endAiContextSection);

    if (aiContextIndex !== -1 && endAiContextIndex !== -1) {
        return context.substring(0, aiContextIndex) + context.substring(endAiContextIndex + endAiContextSection.length);
    }

    return context;
}

export default reset;