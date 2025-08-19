#!/usr/bin/env node

import { Command, Option, InvalidArgumentError } from 'commander';
import configureCli from './src/configure.js';
import harvest from './src/harvest.js';
import reset from './src/reset.js';
import upload from './src/upload.js';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import updateNotifier from 'update-notifier';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));

updateNotifier({ pkg: packageJson }).notify();

const program = new Command();
program.showHelpAfterError();

const tokenEnvName = 'CROWDIN_PERSONAL_TOKEN';
const baseUrlEnvName = 'CROWDIN_BASE_URL';
const projectEnvName = 'CROWDIN_PROJECT_ID';
const openApiEnvName = 'OPENAI_KEY';
const openAiBaseUrlEnvName = 'OPENAI_BASE_URL';
const googleVertexProjectEnvName = 'GOOGLE_VERTEX_PROJECT';
const googleVertexLocationEnvName = 'GOOGLE_VERTEX_LOCATION';
const googleVertexClientEmailEnvName = 'GOOGLE_VERTEX_CLIENT_EMAIL';
const googleVertexPrivateKeyEnvName = 'GOOGLE_VERTEX_PRIVATE_KEY';
const azureResourceNameEnvName = 'AZURE_RESOURCE_NAME';
const azureApiKeyEnvName = 'AZURE_API_KEY';
const azureDeploymentNameEnvName = 'AZURE_DEPLOYMENT_NAME';
const anthropicApiKeyEnvName = 'ANTHROPIC_API_KEY';
const mistralApiKeyEnvName = 'MISTRAL_API_KEY';

program.version(packageJson.version).name('crowdin-context-harvester')
  .description(`CLI tool for adding contextual information for Crowdin strings using AI. 

The CLI pulls your Crowdin strings (their texts and keys), then looks through local files with AI you configure, trying to find contextual information about how those texts are used in your code.

Please carefully select the Crowdin files you want to add context to, as well as the local file glob patterns and ignore patterns, to avoid overusing your AI API credits. 

The CLI will save the found context to the Crowdin project at the very end of execution, as it would try to combine context found in multiple files into one context for each string.

Get started with the CLI by running the ${chalk.green('configure')} command.`);

program
  .command('configure')
  .description('helps you find argument values for the harvest command')
  .addOption(new Option('-t, --token <token>', 'Crowdin Personal API token (with Project, AI scopes)').env(tokenEnvName))
  .addOption(new Option('-u, --url <base-url>', 'Crowdin API url (for enterprise https://<org-name>.api.crowdin.com)').env(baseUrlEnvName))
  .addOption(
    new Option('-k, --openAiKey <openai-api-key>', 'OpenAI API key. Setting this option as an environment variable is recommended.').env(
      openApiEnvName,
    ),
  )
  .addOption(
    new Option(
      '-ob, --openAiBaseUrl <openai-base-url>',
      'OpenAI-compatible API base URL (e.g., http://localhost:8000/v1). Setting this option as an environment variable is recommended.',
    ).env(openAiBaseUrlEnvName),
  )
  .addOption(
    new Option(
      '-gvp, --googleVertexProject <google-vertext-project-id>',
      'Google Cloud Project ID. Setting this option as an environment variable is recommended.',
    ).env(googleVertexProjectEnvName),
  )
  .addOption(
    new Option(
      '-gvl, --googleVertexLocation <google-vertext-location>',
      'Google Cloud Project location. Setting this option as an environment variable is recommended.',
    ).env(googleVertexLocationEnvName),
  )
  .addOption(
    new Option(
      '-gvce, --googleVertexClientEmail <google-vertext-client-email>',
      'Google Cloud service account client email. Setting this option as an environment variable is recommended.',
    ).env(googleVertexClientEmailEnvName),
  )
  .addOption(
    new Option(
      '-gvpk, --googleVertexPrivateKey <google-vertext-private-key>',
      'Google Cloud service account private key. Setting this option as an environment variable is recommended.',
    ).env(googleVertexPrivateKeyEnvName),
  )
  .addOption(
    new Option(
      '-azr, --azureResourceName <azure-resource-name>',
      'MS Azure OpenAI resource name. Setting this option as an environment variable is recommended.',
    ).env(azureResourceNameEnvName),
  )
  .addOption(
    new Option(
      '-azk, --azureApiKey <azure-api-key>',
      'MS Azure OpenAI API key. Setting this option as an environment variable is recommended.',
    ).env(azureApiKeyEnvName),
  )
  .addOption(
    new Option(
      '-azd, --azureDeploymentName <azure-resource-name>',
      'MS Azure OpenAI deployment name. Setting this option as an environment variable is recommended.',
    ).env(azureDeploymentNameEnvName),
  )
  .addOption(
    new Option(
      '-ank, --anthropicApiKey <anthropic-api-key>',
      'Anthropic API key. Setting this option as an environment variable is recommended.',
    ).env(anthropicApiKeyEnvName),
  )
  .addOption(
    new Option(
      '-mk, --mistralApiKey <mistral-api-key>',
      'Mistral API key. Setting this option as an environment variable is recommended.',
    ).env(mistralApiKeyEnvName),
  )
  .aliases(['init'])
  .action(configureCli);

program
  .command('harvest')
  .description('find and add contextual information for translatable text in Crowdin project')
  .addOption(
    new Option('-t, --token <token>', 'Crowdin Personal API token (with Project and AI scopes granted).')
      .makeOptionMandatory()
      .env(tokenEnvName),
  )
  .addOption(new Option('-u, --url <base-url>', 'Crowdin API url (for enterprise https://<org-name>.api.crowdin.com)').env(baseUrlEnvName))
  .addOption(new Option('-p, --project <projectId>', 'Crowdin project ID (e.g., 123456)').makeOptionMandatory().env(projectEnvName))
  .addOption(
    new Option('-a, --ai <provider>', 'AI provider ("openai", "google-vertex", "azure", "anthropic" or "mistral").')
      .default('openai')
      .makeOptionMandatory(),
  )
  .addOption(
    new Option('-k, --openAiKey <key>', 'OpenAI API key. This option is mandatory if "openai" is chosen as the AI provider.').env(
      openApiEnvName,
    ),
  )
  .addOption(
    new Option(
      '-ob, --openAiBaseUrl <base-url>',
      'OpenAI-compatible API base URL (e.g., http://localhost:8000/v1). This option is optional when "openai" is chosen as the AI provider.',
    ).env(openAiBaseUrlEnvName),
  )
  .addOption(
    new Option(
      '-gvp, --googleVertexProject <google-vertext-project-id>',
      'Google Cloud Project ID. This option is mandatory if "google-vertex" is chosen as the AI provider.',
    ).env(googleVertexProjectEnvName),
  )
  .addOption(
    new Option(
      '-gvl, --googleVertexLocation <google-vertext-location>',
      'Google Cloud Project location. This option is mandatory if "google-vertex" is chosen as the AI provider.',
    ).env(googleVertexLocationEnvName),
  )
  .addOption(
    new Option(
      '-gvce, --googleVertexClientEmail <google-vertext-client-email>',
      'Google Cloud service account client email. This option is mandatory if "google-vertex" is chosen as the AI provider.',
    ).env(googleVertexClientEmailEnvName),
  )
  .addOption(
    new Option(
      '-gvpk, --googleVertexPrivateKey <google-vertext-private-key>',
      'Google Cloud service account private key. This option is mandatory if "google-vertex" is chosen as the AI provider.',
    ).env(googleVertexPrivateKeyEnvName),
  )
  .addOption(
    new Option(
      '-azr, --azureResourceName <azure-resource-name>',
      'MS Azure OpenAI resource name. This option is mandatory if "azure" is chosen as the AI provider.',
    ).env(azureResourceNameEnvName),
  )
  .addOption(
    new Option(
      '-azk, --azureApiKey <azure-api-key>',
      'MS Azure OpenAI API key. This option is mandatory if "azure" is chosen as the AI provider.',
    ).env(azureApiKeyEnvName),
  )
  .addOption(
    new Option(
      '-azd, --azureDeploymentName <azure-resource-name>',
      'MS Azure OpenAI deployment name. This option is mandatory if "azure" is chosen as the AI provider.',
    ).env(azureDeploymentNameEnvName),
  )
  .addOption(
    new Option(
      '-ank, --anthropicApiKey <anthropic-api-key>',
      'Anthropic API key. This option is mandatory if "anthropic" is chosen as the AI provider.',
    ).env(anthropicApiKeyEnvName),
  )
  .addOption(
    new Option(
      '-mk, --mistralApiKey <mistral-api-key>',
      'Mistral API key. This option is mandatory if "mistral" is chosen as the AI provider.',
    ).env(mistralApiKeyEnvName),
  )
  .addOption(
    new Option('-m, --model <model>', 'AI model. Should accept at least 128,000 tokens context window and support tool calls.').default(
      'gpt-5',
    ),
  )
  .addOption(new Option('-cp, --promptFile <path>', 'path to a file containing a custom prompt. Use "-" to read from STDIN. (optional)'))
  .addOption(new Option('-c, --crowdinFiles <pattern>', 'Crowdin file names pattern (valid glob pattern)').default('**/*.*'))
  .addOption(
    new Option(
      '-q, --croql <croql>',
      'use CroQL to select a specific subset of strings to extract context for (e.g. strings without AI context, strings modified since specific date, etc.). Cannot be set together with the crowdinFiles argument.',
    ),
  )
  .addOption(
    new Option(
      '-w, --output <csv | terminal | crowdin>',
      'output destination for extracted context. "terminal" can be considered as a dry run. "crowdin" will save the extracted context to the Crowdin project. "csv" will save the extracted context to a CSV file for review.',
    )
      .default('csv')
      .makeOptionMandatory(),
  )
  .addOption(new Option('-f, --csvFile <path>', 'path to the CSV file to save extracted context to.').default('crowdin-context.csv'))
  .addOption(
    new Option(
      '-ap, --append',
      'use this option to append AI context to existing CSV file. this option is useful to harvest context for strings returned by "check" command.',
    ),
  )
  .addOption(
    new Option('-j, --concurrency <n>', 'concurrency level for per-string extraction').default(10).argParser(value => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
        throw new InvalidArgumentError('Invalid value for --concurrency: must be a positive integer');
      }
      return parsed;
    }),
  )
  .aliases(['extract'])
  .addHelpText(
    'after',
    `
It's recommended to configure your Crowdin and AI provider credentials in the environment variables before running the command.

Examples:
    $ crowdin-context-harvester harvest --project=462
    $ crowdin-context-harvester harvest --project=462 --crowdinFiles="strings.xml"
    $ crowdin-context-harvester harvest --project=462 --croql='not (context contains "✨ AI Context")'
    $ crowdin-context-harvester harvest --project=462 --croql="added between '2023-12-06 13:44:14' and '2023-12-07 13:44:14'" --output=terminal
    $ crowdin-context-harvester harvest --project=462 --ai="openai" --openAiKey="sk-xxx" --openAiBaseUrl="http://localhost:8000/v1"
    `,
  )
  .action(harvest);

program
  .command('upload')
  .description('upload the reviewed context to Crowdin project')
  .addOption(new Option('-t, --token <token>', 'Crowdin Personal API token (with Project scope)').makeOptionMandatory().env(tokenEnvName))
  .addOption(new Option('-u, --url <base-url>', 'Crowdin API url (for enterprise https://<org-name>.api.crowdin.com)').env(baseUrlEnvName))
  .addOption(new Option('-p, --project <projectId>', 'Crowdin project ID (e.g., 123456)').makeOptionMandatory().env(projectEnvName))
  .addOption(
    new Option('-f, --csvFile <path>', 'path to the CSV file with reviewed context').default('crowdin-context.csv').makeOptionMandatory(),
  )
  .aliases(['add', 'sync'])
  .addHelpText(
    'after',
    `
It's recommended to configure your Crowdin and AI provider credentials in the environment variables before running the command.

Examples:
    $ crowdin-context-harvester upload --project=462
    $ crowdin-context-harvester upload --project=462 --csvFile "crowdin-context.csv"`,
  )
  .action(upload);

program
  .command('reset')
  .description('remove previously written AI context from Crowdin project')
  .addOption(new Option('-t, --token <token>', 'Crowdin Personal API token (with Project scope)').makeOptionMandatory().env(tokenEnvName))
  .addOption(new Option('-u, --url <base-url>', 'Crowdin API url (for enterprise https://<org-name>.api.crowdin.com)').env(baseUrlEnvName))
  .addOption(new Option('-p, --project <projectId>', 'Crowdin project ID (e.g., 123456)').makeOptionMandatory().env(projectEnvName))
  .addOption(new Option('-c, --crowdinFiles <pattern>', 'Crowdin file names pattern (valid glob pattern)').default('**/*.*'))
  .aliases(['remove', 'clean', 'delete'])
  .addHelpText(
    'after',
    `
It's recommended to configure your Crowdin and AI provider credentials in the environment variables before running the command.

Examples:
    $ crowdin-context-harvester reset -p 462 --crowdinFiles="strings.xml"
    $ crowdin-context-harvester reset -p 462 --crowdinFiles="*.json"`,
  )
  .action(reset);

program.parse(process.argv);
