//@ts-check
import chalk from 'chalk';
import cliWidth from 'cli-width';
import fs from 'fs';
import { globSync } from 'glob';
import { Parser } from 'json2csv';
import ora from 'ora';
import { table } from 'table';
import {generateText, tool} from "ai";
import {z} from 'zod';
import {
    getCrowdin,
    uploadAiStringsToCrowdin,
    getUserId,
    validateAiProviderFields,
    getCrowdinStrings,
    getTokenizer,
    getPrompt,
    getModelLimits,
    stringifyStrings,
    getStringsChunks, getAiClient
} from './utils.js';

// tools that are used in the AI model. this way we get more predictable results from the model
const AI_TOOLS = [{
    type: "function",
    function: {
        name: "setContext",
        description: "Function to set string the context.",
        parameters: {
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
            required: ["id", "context"],
        }
    }
}];

const DEFAULT_PROMPT = `Please, extract the context from the code for the following strings.

- Context is useful information for linguists or an AI translating these texts about how the text is used in the project they are localizing or when it appears in the UI.
- Provide context for string only if exact match of the string's text or string's key are found in the code.
- To set context for string call the setContext tool.

Strings:
%strings%

Code:
%code%`;

const spinner = ora();

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

        if (string && context?.context) {
            if (!string.aiContext) {
                string.aiContext = [];
            }

            string.aiContext.push(context.context);
        }
    }
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
            return content.includes(crowdinString.identifier);
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
 * Stringify files
 *
 * @param {Array<object>} files
 */
function stringifyFiles({ files}) {
    return files.join('');
}

/**
 * Chunks the strings and code into smaller parts if needed and sends them to the AI model
 * 
 * @param {object} param0 
 * @param {object} param0.apiClient
 * @param {object} param0.options
 * @param {Array<object>} param0.crowdinStrings
 * @param {Array<object>} param0.localFiles
 */
async function chunkAndExtract({ apiClient, options, crowdinStrings, localFiles }) {
    // for every local file that matches the glob pattern provided by the user
    spinner.start('Collecting files');
    let filesContent = [];

    if (!localFiles.length) {
        spinner.succeed();
        console.log(`${chalk.gray('  No files found.')}`)
        return { contexts: [] };
    }

    for (const localFile of localFiles) {
        let content;
        try {
            content = fs.readFileSync(localFile, 'utf8'); // get the content of the code file
            content = `Content of ${localFile}:\n\`\`\`\n${content}\n\`\`\`\n\n`;
            filesContent[localFile] = content;
        } catch (error) {
            console.error(`\nError reading file ${localFile}: ${error}. Proceeding with other files...`);
        }
    }

    spinner.succeed();

    const tokenizer = getTokenizer(options.ai, options.model);
    const prompt = getPrompt({ options, defaultPrompt: DEFAULT_PROMPT });

    const modeLimits = getModelLimits(options);
    const stringsChunkLimit = modeLimits.output / 4; // we assume that context will be longer than strings
    const filesChunkLimit = modeLimits.input - modeLimits.output - stringsChunkLimit - tokenizer.encode(prompt).length; // leave full output for context

    const stringsChunks = getStringsChunks({
        crowdinStrings,
        tokenizer,
        chunkLimit: stringsChunkLimit
    });
    const filesChunks = [];

    while(Object.keys(filesContent).length) {
        let chunk = {};
        for (let fileKey of Object.keys(filesContent)) {
            // handle large files: split them to fit in context window
            if (tokenizer.encode(filesContent[fileKey]).length > filesChunkLimit) {
                let largeFileParts = [filesContent[fileKey].replace(`Content of ${fileKey}:`, '')];
                const header = `Part of ${fileKey} content:\n\`\`\`\n`

                const maxNumbersOfSplit = 10;
                let splitsCount = 0;

                try {
                    while (
                      splitsCount < maxNumbersOfSplit
                      && tokenizer.encode(
                        stringifyFiles({
                            files: [header + largeFileParts[0]]
                        })
                      ).length > filesChunkLimit
                      ) {
                        largeFileParts = largeFileParts.reduce((acc, curr) => {
                            const chunks = curr.match(new RegExp('(.|[\r\n]){1,' + Math.ceil(curr.length / 2) + '}', 'g'));
                            acc.push(...chunks);
                            return acc;
                        }, []);
                        splitsCount++;
                    }

                    if (splitsCount >= maxNumbersOfSplit) {
                        console.log(`${chalk.gray(`  ${fileKey} is too large to be processed`)}`);
                    } else {
                        for(let i = 0; i < largeFileParts.length; i++) {
                            filesContent[`${fileKey}-${i}`] = largeFileParts[i];
                        }
                    }
                } catch (e) {
                    console.log(`${chalk.gray(`  ${fileKey} is too large to be processed`)}`);
                }

                delete filesContent[fileKey];
                continue;
            }

            chunk[fileKey] = filesContent[fileKey];
            if (tokenizer.encode(stringifyFiles({ files: Object.values(chunk) })).length > filesChunkLimit) {
                delete chunk[fileKey];
                filesChunks.push(Object.values(chunk));

                const chunkIdentifiers = Object.keys(chunk);
                chunkIdentifiers.forEach(identifier => {
                    delete filesContent[identifier];
                });
                break;
            }
        }

        if (Object.keys(chunk).length === Object.keys(filesContent).length) {
            filesChunks.push(Object.values(chunk));
            filesContent = [];
        }
    }

    const totalChunks = stringsChunks.length * filesChunks.length;
    let chunkNumber = 1;
    let contexts = [];

    for (let stringsChunk of stringsChunks) {
        for (const filesChunk of filesChunks) {
            spinner.start(`Processing chunk ${chunkNumber} of ${totalChunks}`);

            let stringsInFiles = {...stringsChunk};

            // filter out strings that are not present in the code if the user wants to screen them
            if (options.screen === 'keys' || options.screen === 'texts') {
                stringsInFiles = filterStrings(Object.values(stringsInFiles), stringifyFiles({ files: filesChunk }), options.screen);
                stringsInFiles = stringsInFiles.reduce((acc, curr) => {
                    acc[curr.id] = curr;
                    return acc;
                }, {});
            }
            // if there are no strings left after screening, we return an empty context
            if (!Object.keys(stringsInFiles).length) {
                chunkNumber++;
                spinner.succeed();
                continue;
            }

            try {
                const messages = buildMessages({ prompt, strings: stringsInFiles, files: filesChunk });

                const response = await executePrompt({
                    apiClient,
                    messages,
                    options,
                });

                contexts.push(...(response?.contexts || []));
                spinner.succeed();
            } catch (e) {
                spinner.fail();
                console.log(`\n${e?.response?.data?.error?.message || e}`);
            }

            chunkNumber++;
        }
    }

    return { contexts };
}

/**
 * Builds the chat messages for the AI model
 * 
 * @param {object} param0 
 * @param {object} param0.prompt
 * @param {object} param0.strings
 * @param {Array<object>} param0.files
 */
function buildMessages({ prompt, strings, files }) {
    let builtPrompt = prompt.replace('%strings%', stringifyStrings({ strings }));
    builtPrompt = builtPrompt.replace('%code%', stringifyFiles({ files }));

    return [
        {
            role: 'system',
            content: 'Please act as a helpful translator assistant. You will help translator to collect useful information about strings to help better understand string\'s context',
        },
        {
            role: 'user',
            content: builtPrompt,
        }
    ];
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

        const contexts = [];
        (aiResponse?.data?.choices?.[0]?.message?.tool_calls || []).forEach(toolCall => {
            const args = toolCall?.function?.arguments;
            if (args) {
                contexts.push(JSON.parse(args));
            }
        })

        return { contexts };
    }

    let client;
    try {
        client = getAiClient(options);
    } catch(e) {
        console.error('\n\nInvalid AI provider');
        console.error(e);
        process.exit(1);
    }

    const result = await generateText({
        model: client(options.ai === 'azure' ? options.azureDeploymentName : options.model),
        tools: {
            setContext: tool({
                description: 'Function to set string context.',
                parameters: z.object({
                    id: z.number().describe('String ID'),
                    context: z.string().describe('Context for the string'),
                    file: z.any().describe('File where string context was found'),
                }),
            }),
        },
        system: messages[0].content,
        messages: [messages[1]],
    });

    let contexts = [];

    (result?.toolCalls || []).forEach(toolCall => {
        contexts.push(toolCall.args);
    })

    return { contexts };
}

// main function that orchestrates the context extraction process
async function harvest(_name, commandOptions, _command) {
    try {
        const options = commandOptions.opts();

        if (options.append) {
            if (options.output !== 'csv') {
                console.error(`--append can't be used when --output is not equal to "csv"`);
                process.exit(1);
            }
            if (!fs.existsSync(options.csvFile)) {
                console.error(`CSV file doesn't exist, can't run with --append option`);
                process.exit(1);
            }
        }

        if (!['terminal', 'csv', 'crowdin'].includes(options.output)) {
            console.error('Wrong value provided for --output option. terminal, csv and crowdin values are available.');
            process.exit();
        }

        validateAiProviderFields(options);

        const apiClient = await getCrowdin(options);
        const localFiles = globSync(options.localFiles ? options.localFiles.split(';') : [], { ignore: options?.localIgnore ? options.localIgnore.split(';') : [] });

        const strings = await getCrowdinStrings({
            spinner,
            options,
            apiClient,
        });

        let stringsContext = {};

        try {
            stringsContext = await chunkAndExtract({
                apiClient,
                crowdinStrings: strings,
                localFiles,
                options,
            });
        } catch (e) {
            console.log('\nError during context extraction');
            console.error(e);
        }

        try {
            await appendContext(strings, stringsContext);
        } catch (error) {
            console.log('\nError during context appending');
            console.error(error);
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