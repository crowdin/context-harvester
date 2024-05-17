import ora from 'ora';
import inquirer from 'inquirer';
import { getCrowdin } from './utils.js';
import chalk from 'chalk';
import axios from 'axios';

async function configureCli(name, commandOptions, command) {
    const spinner = ora();

    const options = commandOptions.opts();

    const apiClient = await getCrowdin(options);

    let projects;

    try {
        spinner.start(`Loading Crowdin projects...`);
        projects = (await apiClient.projectsGroupsApi.withFetchAll().listProjects()).data.map(project => project.data);
        spinner.succeed();
    } catch (e) {
        spinner.fail(`Error: ${e.message}`);
        process.exit(1);
    }

    if (!projects.length) {
        spinner.fail('No Crowdin projects found');
        process.exit(1);
    }

    const questions = [{
        type: 'list',
        name: 'project',
        message: 'Select the Crowdin project:',
        choices: projects.map(project => { return { name: project.name, value: project.id } }),
    }, {
        type: 'list',
        name: 'ai',
        message: 'Select the AI provider:',
        choices: [{ name: 'Crowdin AI Provider', value: 'crowdin' }, { name: 'OpenAI', value: 'openai' }]
    }, {
        type: 'list',
        name: 'crowdin_ai_id',
        message: 'Select the Crowdin AI provider (you should have the OpenAI provider configured in Crowdin):',
        when: function (answers) {
            return answers.ai === 'crowdin';
        },
        choices: async (answers) => {
            let aiProviders;
            if (apiClient.isEnterprise) {
                aiProviders = (await apiClient.aiApi.withFetchAll().listAiOrganizationProviders()).data.map(provider => provider.data).filter(provider => provider.type == 'open_ai' && provider.isEnabled);
            } else {
                aiProviders = (await apiClient.aiApi.withFetchAll().listAiUserProviders(apiClient.userId)).data.map(provider => provider.data).filter(provider => provider.type == 'open_ai' && provider.isEnabled);
            }

            if (!aiProviders.length) {
                console.error('No configured and enabled OpenAI providers found');
                process.exit(1);
            }

            return aiProviders.map(provider => { return { name: provider.name, value: provider.id } });
        }
    }, {
        type: 'input',
        name: 'openai_key',
        message: 'Enter your OpenAI key:',
        when: function (answers) {
            return answers.ai === 'openai' && !options.openAiKey;
        }
    }, {
        type: 'list',
        name: 'model',
        message: 'Select the AI model (gpt-4o or newer recommended):',
        default: 'gpt-4o',
        choices: async (answers) => {
            if (answers.ai === 'crowdin') {
                let models = [];

                if (apiClient.aiApi.organization) {
                    models = (await apiClient.aiApi.withFetchAll().listAiOrganizationProviderModels(answers.crowdin_ai_id)).data.map(model => model.data);
                } else {
                    models = (await apiClient.aiApi.withFetchAll().listAiUserProviderModels(apiClient.userId, answers.crowdin_ai_id)).data.map(model => model.data);
                }

                if (!models.length) {
                    console.error('No AI models found');
                    process.exit(1);
                }

                return models.map(model => { return { name: model.id, value: model.id } });
            } else {
                try {
                    const openAiModels = (await axios.get('https://api.openai.com/v1/models', {
                        headers: {
                            "Authorization": `Bearer ${process.env.OPENAI_KEY || answers.openai_key}`
                        }
                    })).data;

                    return openAiModels.data.map(model => { return { name: model.id, value: model.id } });
                } catch (e) {
                    console.error(`Error: ${e.message}`);
                    process.exit(1);
                }
            }
        },
    }, {
        type: 'list',
        name: 'screen',
        message: 'Check if the code contains the key or the text of the string before sending it to the AI model \n(recommended if you have thousands of keys to avoid chunking and improve speed).:',
        choices: [{ name: 'I use keys in the code', value: 'keys' }, { name: 'I use texts as keys (reduced extraction efficiency)', value: 'texts' }, { name: 'Do not check (always send all strings with each code file)', value: 'none' }],
        default: 'keys',
    }, {
        type: 'input',
        name: 'promptFile',
        message: 'Enter the path to a file containing a custom prompt (use "-" to read from STDIN). Leave empty to use the default prompt:',
    }, {
        type: 'input',
        name: 'localFiles',
        message: 'Enter the path to the local files (glob pattern):',
        default: '**/*.*',
    }, {
        type: 'input',
        name: 'localIgnore',
        message: 'Enter the path to the local ignore files (glob pattern). Make sure to exclude unnecessary files to avoid unnecessary AI API calls:',
        default: 'node_modules/**',
    }, {
        type: 'input',
        name: 'crowdinFiles',
        message: 'Enter the path to the Crowdin files (glob pattern e.g. **/*.*). Leave empty if --croql will be used:',
        default: '',
    }, {
        type: 'list',
        name: 'yes',
        choices: [{ name: 'Review before saving', value: false }, { name: 'Save extracted content without review', value: true }],
        message: 'Do you want to review and confirm each extracted context manually?',
    }, {
        type: 'input',
        name: 'croql',
        message: 'Enter a CroQL query to select a specific subset of strings to extract context for. Leave empty if --crowdinFiles is used:',
    }, {
        type: 'confirm',
        name: 'dryRun',
        message: 'Do you want to run a dry run (no changes to Crowdin)?',
        default: false
    }];

    const answers = await inquirer.prompt(questions);

    console.log(chalk.hex('#FFA500').bold('\nYou can now execute the harvest command by running:\n'));
    console.log(chalk.green(`crowdin-context-harvester `) +
        chalk.blue('harvest ') +
        chalk.yellow('--project=') + chalk.white(`${answers.project} `) +
        chalk.yellow('--ai=') + chalk.white(`"${answers.ai}" `) +
        (answers.openai_key && !options.openAiKey ? chalk.yellow('--openAiKey=') + chalk.white(`"${answers.openai_key}" `) : '') +
        (answers.crowdin_ai_id ? chalk.yellow('--crowdinAiId=') + chalk.white(`${answers.crowdin_ai_id} `) : '') +
        chalk.yellow('--model=') + chalk.white(`"${answers.model}" `) +
        (answers.promptFile ? chalk.yellow('--promptFile=') + chalk.white(`"${answers.promptFile}" `) : '') +
        chalk.yellow('--localFiles=') + chalk.white(`"${answers.localFiles}" `) +
        chalk.yellow('--localIgnore=') + chalk.white(`"${answers.localIgnore}" `) +
        chalk.yellow('--crowdinFiles=') + chalk.white(`"${answers.crowdinFiles}" `) +
        (answers.screen !== 'none' ? chalk.yellow('--screen=') + chalk.white(`"${answers.screen}" `) : '') +
        (answers.croql.length > 0 ? chalk.yellow('--croql=') + chalk.white(`"${answers.croql.replaceAll('"', '\\\"')}" `) : '') +
        chalk.yellow(answers.dryRun ? `--dryRun ` : '') +
        (answers.yes ? chalk.yellow(`--autoConfirm`) : '')
        + '\n\n'
    );
}

export default configureCli;