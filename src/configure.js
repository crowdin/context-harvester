//@ts-check
import inquirer from 'inquirer';
import { getCrowdin, getUserId } from './utils.js';
import chalk from 'chalk';
import axios from 'axios';

async function configureCli(_name, commandOptions, _command) {
    const options = commandOptions.opts();

    const questions = [{
        type: 'list',
        name: 'crowdin',
        message: 'What Crowdin product do you use?',
        choices: [{ name: 'Crowdin Enterprise', value: 'enterprise' }, { name: 'Crowdin.com', value: 'crowdin' }]
    }, {    // only ask for url if enterprise and not provided as an option
        type: 'input',
        name: 'url',
        message: 'Crowdin organization url (for enterprise https://<org-name>.api.crowdin.com):',
        when: (answers) => (answers.crowdin === 'enterprise' && !options.url),
    }, {    // only ask for token if not provided as an option
        type: 'input',
        name: 'token',
        message: 'Crowdin Personal API token (with Project, AI scopes):',
        validate: async (value, answers) => {
            try {
                const apiClient = await getCrowdin({ token: value, url: answers.url });
                await apiClient.projectsGroupsApi.withFetchAll(1).listProjects({ hasManagerAccess: 1 });   // get one project to test the token

                return true;
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        when: () => !options.token, // only ask for token if not provided as an option
    }, {
        type: 'list',
        name: 'project',
        message: 'Crowdin project:',
        choices: async (answers) => {
            const apiClient = await getCrowdin({ token: answers.token || options.token, url: answers.url || options.url });

            if (apiClient.projectsGroupsApi.organization) {
                return (await apiClient.projectsGroupsApi.withFetchAll().listProjects()).data.map(project => project.data).map(project => { return { name: project.name, value: project.id } });
            } else {
                return (await apiClient.projectsGroupsApi.withFetchAll().listProjects()).data.map(project => project.data).map(project => { return { name: project.name, value: project.id } });
            }
        }
    }, {
        type: 'list',
        name: 'ai',
        message: 'AI provider:',
        choices: [{ name: 'OpenAI', value: 'openai' }, { name: 'Crowdin AI Provider', value: 'crowdin' }],
    }, {
        type: 'list',
        name: 'crowdin_ai_id',
        message: 'Crowdin AI provider (you should have the OpenAI provider configured in Crowdin):',
        when: (answers) => answers.ai === 'crowdin',
        choices: async (answers) => {
            const apiClient = await getCrowdin({ token: answers.token || options.token, url: answers.url || options.url });

            let aiProviders;
            if (apiClient.aiApi.organization) {
                aiProviders = (await apiClient.aiApi.withFetchAll().listAiOrganizationProviders()).data.map(provider => provider.data).filter(provider => provider.type == 'open_ai' && provider.isEnabled);
            } else {
                aiProviders = (await apiClient.aiApi.withFetchAll().listAiUserProviders(await getUserId(apiClient))).data.map(provider => provider.data).filter(provider => provider.type == 'open_ai' && provider.isEnabled);
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
        message: 'OpenAI key:',
        when: (answers) => answers.ai === 'openai' && !options.openAiKey,
    }, {
        type: 'list',
        name: 'model',
        message: 'AI model (gpt-4o or newer required):',
        default: 'gpt-4o',
        choices: async (answers) => {
            if (answers.ai === 'crowdin') {
                const apiClient = await getCrowdin({ token: answers.token || options.token, url: answers.url || options.url });

                let models = [];

                if (apiClient.aiApi.organization) {
                    models = (await apiClient.aiApi.withFetchAll().listAiOrganizationProviderModels(answers.crowdin_ai_id)).data.map(model => model.data);
                } else {
                    models = (await apiClient.aiApi.withFetchAll().listAiUserProviderModels(await getUserId(apiClient), answers.crowdin_ai_id)).data.map(model => model.data);
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
        message: 'Custom prompt file. "-" to read from STDIN (optional):',
    }, {
        type: 'input',
        name: 'localFiles',
        message: 'Local files (glob pattern):',
        default: '**/*.*',
    }, {
        type: 'input',
        name: 'localIgnore',
        message: 'Ignore local files (glob pattern). Make sure to exclude unnecessary files to avoid unnecessary AI API calls:',
        default: '/**/node_modules/**',
    }, {
        type: 'input',
        name: 'crowdinFiles',
        message: 'Crowdin files (glob pattern e.g. **/*.*).:',
        default: '**/*.*',
    }, {
        type: 'input',
        name: 'croql',
        message: 'CroQL query (optional):',
    }, {
        type: 'list',
        name: 'output',
        message: 'Output:',
        default: 'csv',
        choices: [{ name: 'Terminal (dry run)', value: 'terminal' }, { name: 'Crowdin project', value: 'crowdin' }, { name: 'CSV file', value: 'csv' }],
    }, {
        type: 'input',
        name: 'csvFile',
        message: 'Output CSV file (file name or path):',
        default: 'crowdin-context.csv',
        when: (answers) => answers.output === 'csv',
    }];

    const answers = await inquirer.prompt(questions);

    console.log(chalk.hex('#FFA500').bold('\nYou can now execute the harvest command by running:\n'));

    console.log(
        chalk.green(`crowdin-context-harvester `) +
        chalk.blue('harvest ') +
        (answers.url ? chalk.yellow('--url=') + chalk.white(`"${answers.url}" `) : '') +
        (answers.token ? chalk.yellow('--token=') + chalk.white(`"${answers.token}" `) : '') +
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
        chalk.yellow('--output=') + chalk.white(`"${answers.output}" `) +
        (answers.csvFile ? chalk.yellow('--csvFile=') + chalk.white(`"${answers.csvFile}" `) : '')
        + '\n\n'
    );
}

export default configureCli;