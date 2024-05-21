import fs from 'fs';
import { globSync } from 'glob';
import ora from 'ora';
import { getCrowdin, getCrowdinFiles, fetchCrowdinStrings } from './utils.js';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { encode } from 'gpt-tokenizer'
import axios from 'axios';
import Table from 'cli-table3';

const AI_MODEL_CONTEXT_WINDOW = 128000; // the context window size of the recommended AI model

const spinner = ora();

// stringifies chat messages and encodes them into tokens to measure the length
function encodeChat(messages) {
    return encode(messages.map(message => message.content).join('\n\n'));
}

// updates strings in Crowdin with the AI extracted context
async function updateStrings(options, apiClient, project, strings) {
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

// prints the strings that would be updated in a dry run
function dryRunPrint(strings) {
    const table = new Table({
        head: ['Key', 'Text', 'AI Context'],
    });

    const stringsWithAiContext = strings.filter((string) => string.aiContext);

    for (const string of stringsWithAiContext) {
        table.push(
            [string.identifier, string.text, string.aiContext.join('\n')],
        );
    }

    console.log(table.toString());

    console.log(`\n${stringsWithAiContext.length} strings would be updated. Please be aware that an LLM model may return different results for the same input next time you run the tool.\n`);
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

// this function runs at the end of the context extraction process
// it goes through all extracted contexts, compile an array of contexts for every string
// if user wanted to confirm the context, it will ask for confirmation
async function appendContext(options, strings, stringsContext) {
    for (const context of stringsContext?.contexts || []) {
        const string = strings.find((s) => s.id === context.id);

        if (string) {
            if (!string.aiContext) {
                string.aiContext = [];
            }

            let finalContext = null;

            if (!options.autoConfirm && !options.dryRun) {
                const answers = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'confirm',
                    message: `Is the context: \n\n${chalk.green(context.context)}\n\nsuitable for the string: \n\n${chalk.blue(string.identifier || '--no-key-provided--')}: "${chalk.green(string.text)}"\n\n`,
                    default: true,
                }, {
                    type: 'input',
                    name: 'userContext',
                    message: 'If you want to provide a different context, please type it here (leave blank to use the suggested context):',
                    when: (answers) => answers.confirm === false,
                }]);

                finalContext = answers.userContext || context.context;

                if (!answers.confirm && !answers.userContext) {
                    finalContext = null;
                }
            } else {
                finalContext = context.context;
            }

            finalContext && string.aiContext.push(finalContext);
        }
    }
}

// used to split strings into smaller chunks if user has many strings in their Crowdin project
function splitArray(array, maxSize) {
    let result = [];
    for (let i = 0; i < array.length; i += maxSize) {
        result.push(array.slice(i, i + maxSize));
    }
    return result;
}

// screens the code file and filters out strings that are not present in the code
// this is to do not send unnecessary strings to the AI model and reduce chunking
function filterStrings(crowdinStrings, content, screen) {
    return crowdinStrings.filter((crowdinString) => {
        if (screen === 'keys') {
            return content.includes(crowdinString.key);
        } else {
            // Remove actual newline characters and literal \r or \n strings from content and string text
            // Because new lines in the code may differ from the new lines in the Crowdin project
            let cleanedContent = content.replace(/[\r\n]|\\r|\\n/g, '');
            let cleanedStringText = crowdinString.text.replace(/[\r\n]|\\r|\\n/g, '');

            // Check if cleaned content includes cleaned string text
            return cleanedContent.includes(cleanedStringText);
        }
    });
}

// chunks the strings and code into smaller parts if needed and sends them to the AI model
async function chunkAndExtract(apiClient, options, content, crowdinStrings, fileName) {
    spinner.start(`Extracting context from ${chalk.green(fileName)}...`);

    // filter out strings that are not present in the code if the user wants to screen them
    if (options.screen === 'keys' || options.screen === 'texts') {
        crowdinStrings = filterStrings(crowdinStrings, content, options.screen);
    }

    // if there are no strings left after screening, we return an empty context
    if (!crowdinStrings.length) {
        spinner.succeed();
        console.log(`${chalk.gray('  No translatable strings found in the code.')}`)
        return { contexts: [] };
    }

    let result = [];
    let chunks = [crowdinStrings];
    let splitCount = 0;

    // we first try to split the strings into smaller chunks to fit into the AI model context window. 
    // splitting the code is less desirable
    while (encodeChat(buildMessages(options, chunks.flat(), content)).length > AI_MODEL_CONTEXT_WINDOW && splitCount < 10) {
        chunks = chunks.flatMap(chunk => splitArray(chunk, Math.ceil(chunk.length / 2)));
        splitCount++;
    }

    // if the strings + code are still too long, we split the code into smaller chunks
    if (encodeChat(buildMessages(options, chunks.flat(), content)).length > AI_MODEL_CONTEXT_WINDOW) {
        let contentChunks = content.match(new RegExp('.{1,' + Math.ceil(content.length / 2) + '}', 'g'));

        for (let i = 0; i < chunks.length; i++) {
            for (let j = 0; j < contentChunks.length; j++) {
                spinner.start(`Chunk ${i + 1}/${chunks.length} and content chunk ${j + 1}/${contentChunks.length}...`);
                result.push((await executePrompt(apiClient, options, buildMessages(options, chunks[i], contentChunks[j]))).contexts);
                spinner.succeed();
            }
        }
    } else {
        // if chunked strings fit into the AI model with full code, we send every strings chunk with the full code
        for (let chunk of chunks) {
            chunks.length > 1 && spinner.start(`Chunk ${chunks.indexOf(chunk) + 1}/${chunks.length}...`);
            result.push((await executePrompt(apiClient, options, buildMessages(options, chunk, content))).contexts);
            chunks.length > 1 && spinner.succeed();
        }
    }

    spinner.succeed();

    console.log(`  ${chalk.green(crowdinStrings.length)} strings found in the code. New context found for ${chalk.green(result.flat().length)} strings`);

    return {
        contexts: result.flat()
    };
}

// builds the chat messages for the AI model
function buildMessages(options, crowdinStrings, content) {
    return [{
        role: 'system',
        content: 'You are a helpful assistant who extracts context from code for UI labels.',
    },
    {
        role: 'user',
        content: getPrompt(options, JSON.stringify(crowdinStrings, null, 2), content),
    }];
}

// returns the prompt for the AI model, either default or provided by the user
function getPrompt(options, strings, content) {
    const defaultPrompt = `Extract the context for the following UI labels.

 - Context is useful information for linguists or an AI translating these texts about how the text is used in the project they are localizing or when it appears in the UI.
 - Only provide context if exact matches of the strings or keys are found in the code.
 - If no matches are found, do not provide context.
 - Only return context if you find a key or text usage in the code.
 - Any context provided should start with 'Used as...' or 'Appears as...'.
 - Always call the setContext tool to return the context.

Strings:
%strings%

Code:
%code%`;

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

    return prompt.replace('%strings%', strings).replace('%code%', content);
}

// picks a preferred AI provider and executes the prompt
// returns an array of objects, every object is a string id and extracted context
async function executePrompt(apiClient, options, messages) {
    if (options.ai === 'crowdin') {
        let aiResponse;
        if (apiClient.isEnterprise) {
            aiResponse = (await apiClient.aiApi.createAiOrganizationProxyChatCompletion(options.crowdinAiId, {
                model: options.model,
                messages,
                tools: getTools()
            }));
        } else {
            aiResponse = (await apiClient.aiApi.createAiUserProxyChatCompletion(apiClient.userId, options.crowdinAiId, {
                model: options.model,
                messages,
                tools: getTools()
            }));
        }

        const functionArguments = aiResponse?.data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
        return functionArguments ? JSON.parse(functionArguments) : [];
    } else {
        const openAiResponse = (await axios.post('https://api.openai.com/v1/chat/completions', {
            model: options.model,
            tools: getTools(),
            messages,
        }, {
            headers: {
                'Authorization': `Bearer ${options.openAiKey}`,
                'Content-Type': 'application/json'
            }
        }));

        const functionArguments = openAiResponse?.data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
        return functionArguments ? JSON.parse(functionArguments) : [];
    }
}

// returns the tools that are used in the AI model. this way we get more predictable results from the model
function getTools() {
    return [{
        type: "function",
        function: {
            name: "setContext",
            description: "Always use this function to return the context.",
            parameters: {
                type: "object",
                properties: {
                    contexts: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                id: {
                                    type: "number",
                                    description: "Key ID of the string. This is the ID of the string that you are providing context for."
                                },
                                context: {
                                    type: "string",
                                    description: "Context of the string. This is the context that you are providing for the string."
                                }
                            },
                            required: ["id", "context"]
                        },
                    }
                }
            }
        }
    }];
}

// main function that orchestrates the context extraction process
async function harvest(name, commandOptions, command) {
    try {
        const options = commandOptions.opts();

        if (options.ai === 'crowdin' && !options.crowdinAiId) {
            console.error('Error: --crowdinAiId is required when using Crowdin AI');
            process.exit(1);
        }

        if (options.ai === 'openai' && !options.openAiKey.length) {
            console.error('Error: --openAiKey is required when using OpenAI');
            process.exit(1);
        }

        if (!options.crowdinFiles.length && !options.croql.length) {
            console.error('Error: --crowdinFiles or --croql is required');
            process.exit(1);
        }

        const apiClient = await getCrowdin(options);

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
                    containers = await getCrowdinFiles(apiClient, options.project, options.crowdinFiles);
                }
            }
        } catch (error) {
            spinner.fail();
            console.error(`\nError loading Crowdin files: ${error}`);
            process.exit(1);
        }

        spinner.succeed();
        const localFiles = globSync(options.localFiles, { ignore: options?.localIgnore || '' });

        let strings = [];

        // for every branch or file (or one iteration if we are using croql filter)
        for (const container of containers) {
            let stringsBatch = [];
            try {
                spinner.start(`Loading strings from ${chalk.green(container.path || container.name)}`);
                stringsBatch = await fetchCrowdinStrings(apiClient, options.project, isStringsProject, container, strings, options.croql);
                spinner.succeed();
            } catch (error) {
                spinner.fail();
                console.error(`\nError loading strings from ${container.path || container.name}: ${error}. Proceeding with other files...`);
                continue;
            }

            // for every local file that matches the glob pattern provided by the user
            for (const localFile of localFiles) {
                let content;
                try {
                    content = fs.readFileSync(localFile, 'utf8'); // get the content of the code file
                } catch (error) {
                    console.error(`\nError reading file ${localFile}: ${error}. Proceeding with other files...`);
                    continue;
                }

                let context;

                // extract the context from the code file
                try {
                    context = await chunkAndExtract(apiClient, options, content, stringsBatch, localFile);
                } catch (error) {
                    console.error(`\nError extracting context from ${chalk.green(localFile)}: ${error}. Proceeding with other files...`);
                    continue;
                }

                // append newly found context to the array of AI contexts
                try {
                    await appendContext(options, strings, context);
                } catch (error) {
                    console.error(`\nError appending context from ${localFile}: ${error}. AI Might have returned an empty or invalid context. Proceeding with other files...`);
                    console.error(context);
                    continue;
                }
            }
        }

        if (options.dryRun) {
            dryRunPrint(strings);
        } else {
            spinner.start(`Updating Crowdin strings...`);
            updateStrings(options, apiClient, options.project, strings);
            spinner.succeed();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

export default harvest;