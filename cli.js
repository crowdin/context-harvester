#!/usr/bin/env node

import { Command, Option } from 'commander';
import configureCli from './src/configure.js';
import harvest from './src/harvest.js';
import reset from './src/reset.js';
import upload from './src/upload.js';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

program
    .version(JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')).version)
    .name('crowdin-context-harvester')
    .description(`CLI tool for adding contextual information for Crowdin strings using AI. 

The CLI pulls your Crowdin strings (their texts and keys), then looks through local files with AI you configure, trying to find contextual information about how those texts are used in your code.

Please carefully select the Crowdin files you want to add context to, as well as the local file glob patterns and ignore patterns, to avoid overusing your AI API credits. 

The CLI will save the found context to the Crowdin project at the very end of execution, as it would try to combine context found in multiple files into one context for each string.

Get started with the CLI by running the ${chalk.green('configure')} command.`);

program
    .command('configure')
    .description('helps you find argument values for the harvest command')
    .addOption(new Option('-t, --token <token>', 'Crowdin Personal API token (with Project, AI scopes)').env('CROWDIN_TOKEN'))
    .addOption(new Option('-o, --org <organization>', 'Crowdin organization (e.g., acme)').env('CROWDIN_ORG'))
    .addOption(new Option('-k, --openAiKey <key>', 'OpenAI key. Setting OpenAI Key as an environment variable is recommended.').env('OPENAI_KEY'))
    .action(configureCli);

program
    .command('harvest')
    .description('find and add contextual information for translatable text in Crowdin project')
    .addOption(new Option('-t, --token <token>', 'Crowdin Personal API token (with Project and AI scopes granted).').makeOptionMandatory().env('CROWDIN_TOKEN'))
    .addOption(new Option('-o, --org <organization>', 'Crowdin organization (e.g., acme).').env('CROWDIN_ORG'))
    .addOption(new Option('-p, --project <projectId>', 'Crowdin project ID (e.g., 123456)').makeOptionMandatory())
    .addOption(new Option('-a, --ai <provider>', 'AI provider (e.g., "crowdin" or "openai").').makeOptionMandatory())
    .addOption(new Option('-ci, --crowdinAiId <id>', 'Crowdin AI provider ID (e.g. 12). This option is mandatory if "crowdin" is chosen as the AI provider.'))
    .addOption(new Option('-k, --openAiKey <key>', 'OpenAI key. This option is mandatory if "openai" is chosen as the AI provider.').env('OPENAI_KEY'))
    .addOption(new Option('-m, --model <model>', 'AI model. Should accept at least 128,000 tokens context window and support tool calls.').default('gpt-4o').makeOptionMandatory())
    .addOption(new Option('-cp, --promptFile <path>', 'Path to a file containing a custom prompt. Use "-" to read from STDIN.'))
    .addOption(new Option('-l, --localFiles <pattern>', 'local file names pattern (valid glob pattern, multiple patterns are possible, separated by ";".)').default('**/*.*').makeOptionMandatory())
    .addOption(new Option('-i, --localIgnore <pattern>', 'local file names to ignore (valid glob pattern, multiple patterns are possible, separated by ";".)').default('node_modules/**'))
    .addOption(new Option('-c, --crowdinFiles <pattern>', 'Crowdin file names pattern (valid glob pattern)').default(''))
    .addOption(new Option('-q, --croql <croql>', 'use CroQL to select a specific subset of strings to extract context for (e.g. strings without AI context, strings modified since specific date, etc.). Cannot be set together with the crowdinFiles argument.').default(''))
    .addOption(new Option('-s, --screen <keys | texts>', 'check if the code contains the key or the text of the string before sending it to the AI model (recommended if you have thousands of keys to avoid chunking and improve speed). If the text value is selected, efficiency may be reduced.').default('keys'))
    .addOption(new Option('-w, --output <csv | terminal | crowdin>', 'output destination for extracted context. "terminal" can be considered as a dry run. "crowdin" will save the extracted context to the Crowdin project. "csv" will save the extracted context to a CSV file for review.').default('csv').makeOptionMandatory())
    .addOption(new Option('-f, --csvFile <path>', 'path to the CSV file to save extracted context to.'))
    .action(harvest);

program
    .command('upload')
    .description('upload the reviewed context to Crowdin project')
    .addOption(new Option('-t, --token <token>', 'Crowdin Personal API token (with Project scope)').makeOptionMandatory().env('CROWDIN_TOKEN'))
    .addOption(new Option('-o, --org <organization>', 'Crowdin organization (e.g., acme)').env('CROWDIN_ORG'))
    .addOption(new Option('-p, --project <projectId>', 'Crowdin project ID (e.g., 123456)').makeOptionMandatory())
    .addOption(new Option('-f, --csvFile <path>', 'path to the CSV file with reviewed context').makeOptionMandatory())
    .action(upload);

program
    .command('reset')
    .description('remove previously written AI context from Crowdin project')
    .addOption(new Option('-t, --token <token>', 'Crowdin Personal API token (with Project scope)').makeOptionMandatory().env('CROWDIN_TOKEN'))
    .addOption(new Option('-o, --org <organization>', 'Crowdin organization (e.g., acme)').env('CROWDIN_ORG'))
    .addOption(new Option('-p, --project <projectId>', 'Crowdin project ID (e.g., 123456)').makeOptionMandatory())
    .addOption(new Option('-c, --crowdinFiles <pattern>', 'Crowdin file names pattern (valid glob pattern)').default('**/*.*'))
    .action(reset);


program.parse(process.argv);