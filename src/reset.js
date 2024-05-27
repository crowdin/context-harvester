//@ts-check
import ora from 'ora';
import { getCrowdin, getCrowdinFiles, fetchCrowdinStrings, uploadWithoutAiStringsToCrowdin, AI_CONTEXT_SECTION_END } from './utils.js';

const spinner = ora();

async function reset(_name, commandOptions, _command) {
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
            containers = await getCrowdinFiles({
                apiClient,
                project: options.project,
                filesPattern: options.crowdinFiles
            });
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
            const result = await fetchCrowdinStrings({
                apiClient,
                project: options.project,
                isStringsProject,
                container,
            });
            strings.push(...result.crowdinStrings);
        } catch (error) {
            spinner.fail();
            console.error(`Error loading strings from ${container.path || container.name}: ${error}. Proceeding with other files...`);
            continue;
        }

        strings = strings.filter((string) => {
            return string?.context?.indexOf(AI_CONTEXT_SECTION_END) !== -1;
        });

        try {
            await uploadWithoutAiStringsToCrowdin({
                apiClient,
                project: options.project,
                strings,
            });
        } catch (error) {
            spinner.fail();
            console.error(`Error updating strings: ${error}`);
            process.exit(1);
        }

        spinner.succeed();
    }
}

export default reset;