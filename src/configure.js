//@ts-check
import inquirer from 'inquirer';
import { getCrowdin, getUserId, normalizeEnterpriseUrl } from './utils.js';
import chalk from 'chalk';
import axios from 'axios';
import { GoogleAuth } from 'google-auth-library';

async function configureCli(_name, commandOptions, _command) {
  const options = commandOptions.opts();
  let crowdinBaseUrl = normalizeEnterpriseUrl(options.url);

  const questions = [
    {
      type: 'list',
      name: 'crowdin',
      message: 'What Crowdin product do you use?',
      choices: [
        { name: 'Crowdin Enterprise', value: 'enterprise' },
        { name: 'Crowdin.com', value: 'crowdin' },
      ],
    },
    {
      // only ask for url if enterprise and not provided as an option
      type: 'input',
      name: 'url',
      message: 'Crowdin organization url (for enterprise https://<org-name>.api.crowdin.com):',
      when: answers => answers.crowdin === 'enterprise' && !options.url,
      filter: value => ((crowdinBaseUrl = normalizeEnterpriseUrl(value)), crowdinBaseUrl),
    },
    {
      // only ask for token if not provided as an option
      type: 'input',
      name: 'token',
      message: 'Crowdin Personal API token (with Project, AI scopes):',
      validate: async value => {
        try {
          const apiClient = await getCrowdin({ token: value, url: crowdinBaseUrl });
          await apiClient.projectsGroupsApi.withFetchAll(1).listProjects({ hasManagerAccess: 1 }); // get one project to test the token

          return true;
        } catch (e) {
          return `Error: ${e.message}`;
        }
      },
      when: () => !options.token, // only ask for token if not provided as an option
    },
    {
      type: 'list',
      name: 'project',
      message: 'Crowdin project:',
      choices: async answers => {
        const apiClient = await getCrowdin({ token: answers.token || options.token, url: crowdinBaseUrl });

        if (apiClient.projectsGroupsApi.organization) {
          return (await apiClient.projectsGroupsApi.withFetchAll().listProjects()).data
            .map(project => project.data)
            .map(project => {
              return { name: project.name, value: project.id };
            });
        } else {
          return (await apiClient.projectsGroupsApi.withFetchAll().listProjects()).data
            .map(project => project.data)
            .map(project => {
              return { name: project.name, value: project.id };
            });
        }
      },
    },
    {
      type: 'list',
      name: 'ai',
      message: 'AI provider:',
      choices: [
        { name: 'OpenAI (OpenAI API or OpenAI-compatible API)', value: 'openai' },
        { name: 'Google Gemini (Vertex AI API)', value: 'google-vertex' },
        { name: 'MS Azure OpenAI', value: 'azure' },
        { name: 'Anthropic', value: 'anthropic' },
        { name: 'Mistral', value: 'mistral' },
      ],
    },
    {
      type: 'input',
      name: 'openai_key',
      message: 'OpenAI API key:',
      when: answers => answers.ai === 'openai' && !options.openAiKey,
    },
    {
      type: 'input',
      name: 'openai_base_url',
      message: 'OpenAI-compatible API base URL (optional, defaults to https://api.openai.com/v1):',
      when: answers => answers.ai === 'openai' && !options.openAiBaseUrl,
    },
    {
      type: 'input',
      name: 'google_vertex_project',
      message: 'Google Cloud project ID:',
      when: answers => answers.ai === 'google-vertex' && !options.googleVertexProject,
    },
    {
      type: 'input',
      name: 'google_vertex_location',
      message: 'Google Cloud project location:',
      when: answers => answers.ai === 'google-vertex' && !options.googleVertexLocation,
    },
    {
      type: 'input',
      name: 'google_vertex_client_email',
      message: 'Google Cloud service account client email:',
      when: answers => answers.ai === 'google-vertex' && !options.googleVertexClientEmail,
    },
    {
      type: 'input',
      name: 'google_vertex_private_key',
      message: 'Google Cloud service account private key:',
      when: answers => answers.ai === 'google-vertex' && !options.googleVertexPrivateKey,
    },
    {
      type: 'input',
      name: 'azure_resource_name',
      message: 'MS Azure OpenAI resource name:',
      when: answers => answers.ai === 'azure' && !options.azureResourceName,
    },
    {
      type: 'input',
      name: 'azure_api_key',
      message: 'MS Azure OpenAI API key:',
      when: answers => answers.ai === 'azure' && !options.azureApiKey,
    },
    {
      type: 'input',
      name: 'azure_deployment_name',
      message: 'MS Azure OpenAI deployment name:',
      when: answers => answers.ai === 'azure' && !options.azureDeploymentName,
    },
    {
      type: 'input',
      name: 'anthropic_api_key',
      message: 'Anthropic API key:',
      when: answers => answers.ai === 'anthropic' && !options.anthropicApiKey,
    },
    {
      type: 'input',
      name: 'mistral_api_key',
      message: 'Mistral API key:',
      when: answers => answers.ai === 'mistral' && !options.mistralApiKey,
    },
    {
      type: 'list',
      name: 'model',
      message: 'AI model (newest models with largest context window are preferred):',
      when: answers => answers.ai !== 'azure',
      choices: async answers => {
        if (answers.ai === 'openai') {
          try {
            // Use custom base URL if provided, otherwise default to OpenAI
            const baseUrl = process.env.OPENAI_BASE_URL || answers.openai_base_url || 'https://api.openai.com/v1';
            const openAiModels = (
              await axios.get(`${baseUrl}/models`, {
                headers: {
                  Authorization: `Bearer ${process.env.OPENAI_KEY || answers.openai_key}`,
                },
              })
            ).data;

            return openAiModels.data.map(model => {
              return { name: model.id, value: model.id };
            });
          } catch (e) {
            console.error(`Error: ${e.message}`);
            process.exit(1);
          }
        }

        if (answers.ai === 'mistral') {
          return ['mistral-large-latest', 'ministral-8b-latest', 'ministral-3b-latest', 'mistral-small-latest'].map(model => ({
            value: model,
            label: model,
          }));
        }

        if (answers.ai === 'anthropic') {
          return [
            'claude-opus-4-20250514',
            'claude-sonnet-4-20250514',
            'claude-3-7-sonnet-20250219',
            'claude-3-5-sonnet-20240620',
            'claude-3-opus-20240229',
            'claude-3-sonnet-20240229',
            'claude-3-haiku-20240307',
          ].map(model => ({
            value: model,
            label: model,
          }));
        }

        if (answers.ai === 'google-vertex') {
          try {
            const location = process.env.GOOGLE_VERTEX_LOCATION || answers.google_vertex_location;
            const project = process.env.GOOGLE_VERTEX_PROJECT || answers.google_vertex_project;

            const auth = new GoogleAuth({
              scopes: 'https://www.googleapis.com/auth/cloud-platform',
              credentials: {
                private_key: process.env.GOOGLE_VERTEX_PRIVATE_KEY || answers.google_vertex_private_key.replace(/\\n/g, '\n'),
                client_email: process.env.GOOGLE_VERTEX_CLIENT_EMAIL || answers.google_vertex_client_email,
              },
            });
            const token = await auth.getAccessToken();

            const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/models`;
            const models =
              (
                await axios.get(url, {
                  headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                })
              )?.data?.models || [];

            return [
              ...[
                'gemini-1.5-pro',
                'gemini-1.5-pro-002',
                'gemini-1.5-pro-001',
                'gemini-1.5-flash',
                'gemini-1.5-flash-001',
                'gemini-1.5-flash-002',
                'gemini-2.5-pro',
                'gemini-2.5-flash',
              ].map(model => ({
                value: model,
                label: model,
              })),
              ...models.map(model => ({
                value: model.displayName,
                label: model.displayName,
              })),
            ];
          } catch (e) {
            console.error(`Error: ${e.message}`);
            process.exit(1);
          }
        }
      },
    },
    {
      type: 'input',
      name: 'promptFile',
      message: 'Custom prompt file. "-" to read from STDIN (optional):',
    },
    {
      type: 'input',
      name: 'crowdinFiles',
      message: 'Crowdin files (glob pattern e.g. **/*.*).:',
      default: '**/*.*',
    },
    {
      type: 'input',
      name: 'croql',
      message: 'CroQL query (optional):',
    },
    {
      type: 'list',
      name: 'output',
      message: 'Output:',
      default: 'csv',
      choices: [
        { name: 'Terminal (dry run)', value: 'terminal' },
        { name: 'Crowdin project', value: 'crowdin' },
        { name: 'CSV file', value: 'csv' },
      ],
    },
    {
      type: 'input',
      name: 'csvFile',
      message: 'Output CSV file (file name or path):',
      default: 'crowdin-context.csv',
      when: answers => answers.output === 'csv',
    },
    {
      type: 'input',
      name: 'concurrency',
      message: 'Parallelism (concurrency) level for per-string extraction:',
      default: '10',
      validate: value => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
          return 'Please enter a positive integer';
        }
        return true;
      },
    },
  ];

  const answers = await inquirer.prompt(questions);

  console.log(chalk.hex('#FFA500').bold('\nYou can now execute the harvest command by running:\n'));

  console.log(
    chalk.green(`crowdin-context-harvester `) +
      chalk.blue('harvest ') +
      (answers.url ? chalk.yellow('--url=') + chalk.white(`"${answers.url}" `) : '') +
      (answers.token ? chalk.yellow('--token=') + chalk.white(`"${answers.token}" `) : '') +
      chalk.yellow('--project=') +
      chalk.white(`${answers.project} `) +
      chalk.yellow('--ai=') +
      chalk.white(`"${answers.ai}" `) +
      (answers.openai_key && !options.openAiKey ? chalk.yellow('--openAiKey=') + chalk.white(`"${answers.openai_key}" `) : '') +
      (answers.openai_base_url && !options.openAiBaseUrl
        ? chalk.yellow('--openAiBaseUrl=') + chalk.white(`"${answers.openai_base_url}" `)
        : '') +
      (answers.google_vertex_project && !options.googleVertexProject
        ? chalk.yellow('--googleVertexProject=') + chalk.white(`"${answers.google_vertex_project}" `)
        : '') +
      (answers.google_vertex_location && !options.googleVertexLocation
        ? chalk.yellow('--googleVertexLocation=') + chalk.white(`"${answers.google_vertex_location}" `)
        : '') +
      (answers.google_vertex_client_email && !options.googleVertexClientEmail
        ? chalk.yellow('--googleVertexClientEmail=') + chalk.white(`"${answers.google_vertex_client_email}" `)
        : '') +
      (answers.google_vertex_private_key && !options.googleVertexPrivateKey
        ? chalk.yellow('--googleVertexPrivateKey=') + chalk.white(`"${answers.google_vertex_private_key}" `)
        : '') +
      (answers.azure_resource_name && !options.azureResourceName
        ? chalk.yellow('--azureResourceName=') + chalk.white(`"${answers.azure_resource_name}" `)
        : '') +
      (answers.azure_api_key && !options.azureApiKey ? chalk.yellow('--azureApiKey=') + chalk.white(`"${answers.azure_api_key}" `) : '') +
      (answers.azure_deployment_name && !options.azureDeploymentName
        ? chalk.yellow('--azureDeploymentName=') + chalk.white(`"${answers.azure_deployment_name}" `)
        : '') +
      (answers.anthropic_api_key && !options.anthropicApiKey
        ? chalk.yellow('--anthropicApiKey=') + chalk.white(`"${answers.anthropic_api_key}" `)
        : '') +
      (answers.mistral_api_key && !options.mistralApiKey
        ? chalk.yellow('--mistralApiKey=') + chalk.white(`"${answers.mistral_api_key}" `)
        : '') +
      (answers.ai !== 'azure' ? chalk.yellow('--model=') + chalk.white(`"${answers.model}" `) : '') +
      (answers.promptFile ? chalk.yellow('--promptFile=') + chalk.white(`"${answers.promptFile}" `) : '') +
      chalk.yellow('--crowdinFiles=') +
      chalk.white(`"${answers.crowdinFiles}" `) +
      (answers.croql.length > 0 ? chalk.yellow('--croql=') + chalk.white(`"${answers.croql.replaceAll('"', '\\\"')}" `) : '') +
      chalk.yellow('--output=') +
      chalk.white(`"${answers.output}" `) +
      (answers.csvFile ? chalk.yellow('--csvFile=') + chalk.white(`"${answers.csvFile}" `) : '') +
      (answers.concurrency ? chalk.yellow('--concurrency=') + chalk.white(`${answers.concurrency} `) : '') +
      '\n\n',
  );
}

export default configureCli;
