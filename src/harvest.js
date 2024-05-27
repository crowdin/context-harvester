//@ts-check
import axios from 'axios';
import chalk from 'chalk';
import cliWidth from 'cli-width';
import fs from 'fs';
import { globSync } from 'glob';
import { encode } from 'gpt-tokenizer';
import { Parser } from 'json2csv';
import ora from 'ora';
import { table } from 'table';
import { fetchCrowdinStrings, getCrowdin, getCrowdinFiles, uploadAiStringsToCrowdin, getUserId } from './utils.js';

const AI_MODEL_CONTEXT_WINDOW = 128000; // the context window size of the recommended AI model

// tools that are used in the AI model. this way we get more predictable results from the model
const AI_TOOLS = [{
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

const DEFAULT_PROMPT = `Extract the context for the following UI labels.

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

const spinner = ora();

/**
 * Stringifies chat messages and encodes them into tokens to measure the length
 * 
 * @param {Array<object>} messages
 */
function encodeChat(messages) {
    return encode(messages.map(message => message.content).join('\n\n'));
}

/**
 * Prints the strings that would be updated in a dry run
 * 
 * @param {Array<object>} strings
 */
function dryRunPrint(strings) {
    const stringsWithAiContext = strings.filter((string) => string.aiContext);

    const terminalWidth = cliWidth();

    // Calculate the width for each column
    const idColumnWidth = Math.floor(terminalWidth * 0.15);
    const textColumnWidth = Math.floor(terminalWidth * 0.35);
    const contextColumnWidth = Math.floor(terminalWidth * 0.45);

    const config = {
        header: {
            alignment: 'center',
            content: 'Strings with AI Context'
        },
        columns: [
            {
                width: idColumnWidth,
                wrapWord: true
            },
            {
                width: textColumnWidth,
                wrapWord: true
            },
            {
                width: contextColumnWidth,
                wrapWord: true
            }
        ]
    };

    let data = [];
    for (const string of stringsWithAiContext) {
        data.push([string.identifier, string.text, string.aiContext.join('\n')]);
    }

    if (data.length < 1) {
        console.log(`\nNo context found for any strings.\n`);
        return;
    }

    console.log('\n');
    //@ts-ignore
    console.log(table(data, config));

    console.log(`\n${stringsWithAiContext.length} strings would be updated. Please be aware that an LLM model may return different results for the same input next time you run the tool.\n`);
}

/**
 * Writes the strings with AI context to a CSV file
 * 
 * @param {object} options 
 * @param {Array<object>} strings
 */
function writeCsv(options, strings) {
    const csvFile = options.csvFile;

    const stringsWithAiContext = strings.filter((string) => string.aiContext);

    const data = stringsWithAiContext.map((string) => {
        return {
            id: string.id,
            key: string.identifier,
            text: string.text,
            context: string.context,
            aiContext: string.aiContext.join('\n'),
        };
    });

    if (data.length < 1) {
        console.log(`\nNo context found for any strings.\n`);
        return;
    }

    try {
        const parser = new Parser({ fields: ['id', 'key', 'text', 'context', 'aiContext'] });
        const csv = parser.parse(data);

        fs.writeFileSync(csvFile, csv);
        console.log(`\n${data.length} strings saved to ${chalk.green(csvFile)}\n`);
    } catch (err) {
        console.error(`Error writing CSV file: ${err}`);
    }
}

/**
 * This function runs at the end of the context extraction process
 * it goes through all extracted contexts, compile an array of contexts for every string
 * if user wanted to confirm the context, it will ask for confirmation
 * 
 * @param {Array<object>} strings 
 * @param {object} [stringsContext]
 */
async function appendContext(strings, stringsContext) {
    for (const context of stringsContext?.contexts || []) {
        const string = strings.find((s) => s.id === context.id);

        if (string) {
            if (!string.aiContext) {
                string.aiContext = [];
            }

            context?.context && string.aiContext.push(context.context);
        }
    }
}

/**
 * Used to split strings into smaller chunks if user has many strings in their Crowdin project
 * 
 * @param {Array<object>} array 
 * @param {number} maxSize 
 * @returns 
 */
function splitArray(array, maxSize) {
    let result = [];
    for (let i = 0; i < array.length; i += maxSize) {
        result.push(array.slice(i, i + maxSize));
    }
    return result;
}

/**
 * Screens the code file and filters out strings that are not present in the code
 * this is to do not send unnecessary strings to the AI model and reduce chunking
 * 
 * @param {Array<object>} crowdinStrings 
 * @param {string} content 
 * @param {string} screen
 */
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

/**
 * Chunks the strings and code into smaller parts if needed and sends them to the AI model
 * 
 * @param {object} param0 
 * @param {object} param0.apiClient
 * @param {object} param0.options
 * @param {string} param0.content
 * @param {Array<object>} param0.crowdinStrings
 * @param {string} param0.fileName
 */
async function chunkAndExtract({ apiClient, options, content, crowdinStrings, fileName }) {
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

    let fullMessage = buildMessages({ options, crowdinStrings: chunks.flat(), content });

    // we first try to split the strings into smaller chunks to fit into the AI model context window. 
    // splitting the code is less desirable
    while (encodeChat(fullMessage).length > AI_MODEL_CONTEXT_WINDOW && splitCount < 10) {
        chunks = chunks.flatMap(chunk => splitArray(chunk, Math.ceil(chunk.length / 2)));
        splitCount++;
    }

    fullMessage = buildMessages({ options, crowdinStrings: chunks.flat(), content });

    // if the strings + code are still too long, we split the code into smaller chunks
    if (encodeChat(fullMessage).length > AI_MODEL_CONTEXT_WINDOW) {
        const contentChunks = content.match(new RegExp('.{1,' + Math.ceil(content.length / 2) + '}', 'g')) || '';

        for (let i = 0; i < chunks.length; i++) {
            for (let j = 0; j < contentChunks.length; j++) {
                spinner.start(`Chunk ${i + 1}/${chunks.length} and content chunk ${j + 1}/${contentChunks.length}...`);
                const newAiContext = await executePrompt({
                    apiClient,
                    options,
                    messages: buildMessages({ options, crowdinStrings: chunks[i], content: contentChunks[j] }),
                });
                result.push(newAiContext.contexts);
                spinner.succeed();
            }
        }
    } else {
        // if chunked strings fit into the AI model with full code, we send every strings chunk with the full code
        for (let chunk of chunks) {
            chunks.length > 1 && spinner.start(`Chunk ${chunks.indexOf(chunk) + 1}/${chunks.length}...`);
            const newAiContext = await executePrompt({
                apiClient,
                options,
                messages: buildMessages({ options, crowdinStrings: chunk, content }),
            });
            result.push(newAiContext.contexts);
            chunks.length > 1 && spinner.succeed();
        }
    }

    spinner.succeed();

    console.log(`  ${chalk.green(crowdinStrings.length)} strings found in the code. New context found for ${chalk.green(result.flat().length)} strings`);

    return {
        contexts: result.flat()
    };
}

/**
 * Builds the chat messages for the AI model
 * 
 * @param {object} param0 
 * @param {object} param0.options
 * @param {Array<object>} param0.crowdinStrings
 * @param {string} param0.content
 */
function buildMessages({ options, crowdinStrings, content }) {
    const strings = JSON.stringify(crowdinStrings, null, 2);
    return [{
        role: 'system',
        content: 'You are a helpful assistant who extracts context from code for UI labels.',
    },
    {
        role: 'user',
        content: getPrompt({ options, strings, content }),
    }];
}

/**
 * Returns the prompt for the AI model, either default or provided by the user
 * 
 * @param {object} param0 
 * @param {object} param0.options 
 * @param {string} param0.strings 
 * @param {string} param0.content
 */
function getPrompt({ options, strings, content }) {
    let prompt = DEFAULT_PROMPT;

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

/**
 * Picks a preferred AI provider and executes the prompt
 * Returns an array of objects, every object is a string id and extracted context
 * 
 * @param {object} param0 
 * @param {object} param0.apiClient
 * @param {object} param0.options
 * @param {Array<object>} param0.messages
 */
async function executePrompt({ apiClient, options, messages }) {
    if (options.ai === 'crowdin') {
        let aiResponse;
        if (apiClient.aiApi.organization) {
            aiResponse = (await apiClient.aiApi.createAiOrganizationProxyChatCompletion(options.crowdinAiId, {
                model: options.model,
                messages,
                tools: AI_TOOLS
            }));
        } else {
            aiResponse = (await apiClient.aiApi.createAiUserProxyChatCompletion(await getUserId(apiClient), options.crowdinAiId, {
                model: options.model,
                messages,
                tools: AI_TOOLS
            }));
        }

        const functionArguments = aiResponse?.data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
        return functionArguments ? JSON.parse(functionArguments) : [];
    } else if (options.ai === 'openai') {
        const openAiResponse = (await axios.post('https://api.openai.com/v1/chat/completions', {
            model: options.model,
            tools: AI_TOOLS,
            messages,
        }, {
            headers: {
                'Authorization': `Bearer ${options.openAiKey}`,
                'Content-Type': 'application/json'
            }
        }));

        const functionArguments = openAiResponse?.data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
        return functionArguments ? JSON.parse(functionArguments) : [];
    } else {
        console.error('\n\nInvalid AI provider');
        process.exit(1);
    }
}

// main function that orchestrates the context extraction process
async function harvest(_name, commandOptions, _command) {
    try {
        const options = commandOptions.opts();

        if (options.ai === 'crowdin' && !options.crowdinAiId) {
            console.error('error: --crowdinAiId is required when using Crowdin AI');
            process.exit(1);
        }

        if (options.ai === 'openai' && !options.openAiKey.length) {
            console.error('error: --openAiKey is required when using OpenAI');
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
                    containers = await getCrowdinFiles({
                        apiClient,
                        project: options.project,
                        filesPattern: options.crowdinFiles
                    });
                }
            }
        } catch (error) {
            spinner.fail();
            console.error(`\nError loading Crowdin files: ${error}`);
            process.exit(1);
        }

        spinner.succeed();

        const localFiles = globSync(options.localFiles ? options.localFiles.split(';') : [], { ignore: options?.localIgnore ? options.localIgnore.split(';') : [] });

        let strings = [];

        // for every branch or file (or one iteration if we are using croql filter)
        for (const container of containers) {
            let stringsBatch = [];
            try {
                spinner.start(`Loading strings from ${chalk.green(container.path || container.name)}`);
                const result = await fetchCrowdinStrings({
                    apiClient,
                    project: options.project,
                    isStringsProject,
                    container,
                    croql: options.croql
                });
                strings.push(...result.crowdinStrings);
                stringsBatch = result.strings;
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
                    context = await chunkAndExtract({
                        apiClient,
                        options,
                        content,
                        crowdinStrings: stringsBatch,
                        fileName: localFile,
                    });
                } catch (error) {
                    console.error(`\nError extracting context from ${chalk.green(localFile)}: ${error}. Proceeding with other files...`);
                    continue;
                }

                // append newly found context to the array of AI contexts
                try {
                    await appendContext(strings, context);
                } catch (error) {
                    console.error(`\nError appending context from ${localFile}: ${error}. AI Might have returned an empty or invalid context. Proceeding with other files...`);
                    console.error(context);
                    continue;
                }
            }
        }

        if (options.output === 'terminal') {
            dryRunPrint(strings);
        } else if (options.output === 'csv') {
            writeCsv(options, strings);
        } else if (options.output === 'crowdin') {
            spinner.start(`Updating Crowdin strings...`);
            await uploadAiStringsToCrowdin({
                apiClient,
                project: options.project,
                strings
            });
            spinner.succeed();
        }
    } catch (error) {
        console.error('error:', error);
    }
}

export default harvest;