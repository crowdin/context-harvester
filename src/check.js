//@ts-check
import chalk from 'chalk';
import cliWidth from 'cli-width';
import fs from 'fs';
import { Parser } from 'json2csv';
import ora from 'ora';
import { table } from 'table';
import {
    getCrowdin,
    getUserId,
    getCrowdinStrings,
    validateAiProviderFields,
    getTokenizer,
    getPrompt,
    getStringsChunks,
    getModelLimits, getAiClient, stringifyStrings
} from './utils.js';
import {generateText, tool} from "ai";
import {z} from 'zod';

// tools that are used in the AI model. this way we get more predictable results from the model
const AI_TOOLS = [{
    type: "function",
    function: {
        name: "getMoreContext",
        description: "Use this function to get more context for string.",
        parameters: {
            type: "object",
            properties: {
                strings: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            id: {
                                type: "number",
                                description: "This is the ID of the string that have not sufficient context."
                            },
                            error: {
                                type: "string",
                                description: "Error that describe problems with provided context."
                            }
                        },
                        required: ["id", "error"]
                    },
                }
            }
        }
    }
}];

const DEFAULT_PROMPT = `You are working on a list of strings. Each strings has text and context. Context is useful information that should be used to provide high-quality translation. 

Check if each string has enough information to provide unequivocal high-quality translation for each project target language. Use getMoreContext function to get more information about string if needed for unequivocal high-quality translation. Describe what information can be useful for translation and what problems can emerge with translation.

Project target languages: %targetLanguages%.

Strings (serialised as JSON):
%strings%
`;

const spinner = ora();

/**
 * Prints the strings that would be updated in a dry run
 * 
 * @param {Array<object>} strings
 */
function dryRunPrint(strings) {
    const stringsWithErrors = strings.filter((string) => string.errors);

    const terminalWidth = cliWidth();

    // Calculate the width for each column
    const idColumnWidth = Math.ceil(terminalWidth * 0.13);
    const textColumnWidth = Math.ceil(terminalWidth * 0.26);
    const contextColumnWidth = Math.ceil(terminalWidth * 0.26);
    const errorColumnWidth = Math.ceil(terminalWidth * 0.26);

    const config = {
        header: {
            alignment: 'center',
            content: 'Strings with errors'
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
            },
            {
                width: errorColumnWidth,
                wrapWord: true
            }
        ]
    };

    let data = [];
    for (const string of stringsWithErrors) {
        data.push([string.identifier, string.text, string.context, string.errors.join('\n')]);
    }

    if (data.length < 1) {
        console.log(`\nNo strings with insufficient context found.\n`);
        return;
    }

    console.log('\n');
    //@ts-ignore
    console.log(table(data, config));

    console.log(`\n${stringsWithErrors.length} strings have context errors. Please be aware that an LLM model may return different results for the same input next time you run the tool.\n`);
}

/**
 * Writes the strings with AI context to a CSV file
 * 
 * @param {object} options 
 * @param {Array<object>} strings
 */
function writeCsv(options, strings) {
    const csvFile = options.csvFile;

    const stringsWithErrors = strings.filter((string) => string.errors);

    const data = stringsWithErrors.map((string) => {
        return {
            id: string.id,
            key: string.identifier,
            text: string.text,
            context: string.context,
            errors: string.errors.join('\n'),
        };
    });

    if (data.length < 1) {
        console.log(`\nNo strings with insufficient context found.\n`);
        return;
    }

    try {
        const parser = new Parser({ fields: ['id', 'key', 'text', 'context', 'errors'] });
        const csv = parser.parse(data);

        fs.writeFileSync(csvFile, csv);
        console.log(`\n${data.length} strings saved to ${chalk.green(csvFile)}\n`);
    } catch (err) {
        console.error(`Error writing CSV file: ${err}`);
    }
}

/**
 * @param {Array<object>} strings 
 * @param {object} [checkResults]
 */
async function appendCheckResults(strings, checkResults) {
    for (const result of checkResults?.errors || []) {
        const string = strings.find((s) => s.id === result.id);

        if (string && result?.error) {
            if (!string.errors) {
                string.errors = [];
            }

            string.errors.push(result?.error);
        }
    }
}

/**
 * Chunks the strings and code into smaller parts if needed and sends them to the AI model
 * 
 * @param {object} param0 
 * @param {object} param0.apiClient
 * @param {object} param0.options
 * @param {Array<object>} param0.crowdinStrings
 */
async function checkStringsContext({ apiClient, options, crowdinStrings }) {
    // if there are no strings left after screening, we return an empty context
    if (!crowdinStrings.length) {
        console.log(`${chalk.gray('  No strings found.')}`)
        return { errors: [] };
    }

    const project = (await apiClient.projectsGroupsApi.getProject(options.project)).data;
    const languages = (await apiClient.languagesApi.withFetchAll().listSupportedLanguages()).data;
    const targetLanguageNames = project.targetLanguageIds.map(id => languages.find(({ data }) => data.id === id)?.data?.name).filter(a => !!a);

    const tokenizer = getTokenizer(options.ai, options.model);
    const prompt = getPrompt({ options, defaultPrompt: DEFAULT_PROMPT });

    const modeLimits = getModelLimits(options);
    const stringsChunkLimit = modeLimits.output / 4; // we assume that context will be longer than strings

    const stringsChunks = getStringsChunks({
        crowdinStrings,
        tokenizer,
        chunkLimit: stringsChunkLimit
    });

    let chunkNumber = 1;
    let errors = [];

    for (const stringsChunk of stringsChunks) {
        spinner.start(`Processing chunk ${chunkNumber} of ${stringsChunks.length}`);

        try {
            const messages = buildMessages({ prompt, strings: stringsChunk, targetLanguageNames });

            const response = await executePrompt({
                apiClient,
                messages,
                options,
            });

            errors.push(...(response?.errors || []));
            spinner.succeed();
        } catch (e) {
            spinner.fail();
            console.log(`\n${e?.response?.data?.error?.message || e}`);
        }

        chunkNumber++;
    }

    return { errors };
}

/**
 * Builds the chat messages for the AI model
 * 
 * @param {object} param0 
 * @param {object} param0.prompt
 * @param {object} param0.strings
 */
function buildMessages({ prompt, strings, targetLanguageNames }) {
    const builtPrompt = prompt.replace('%strings%', stringifyStrings({ strings })).replace('%targetLanguages%', targetLanguageNames.join(', '));

    return [
        {
            role: 'system',
            content: 'You are helpful translator\'s assistant.',
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

        const errors = [];
        (aiResponse?.data?.choices?.[0]?.message?.tool_calls || []).forEach(toolCall => {
            const args = toolCall?.function?.arguments;
            errors.push(...(args ? JSON.parse(args) : []));
        })

        return { errors };
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
            getMoreContext: tool({
                description: 'Use this function to get more context for string.',
                parameters: z.object({
                    strings: z.array(
                      z.object({
                          id: z.number().describe('This is the ID of the string that have not sufficient context.'),
                          error: z.string().describe('Error that describe problems with provided context.'),
                      })
                    ).describe('Array of errors to set'),
                }),
            }),
        },
        system: messages[0].content,
        messages: [messages[1]],
    });

    let errors = [];

    (result?.toolCalls || []).forEach(toolCall => {
      errors.push(
        ...toolCall.args.strings,
      );
    })

    return { errors };
}

// main function that orchestrates the context check process
async function check(_name, commandOptions, _command) {
    try {
        const options = commandOptions.opts();

        if (!['terminal', 'csv'].includes(options.output)) {
            console.error('Wrong value provided for --output option. terminal, csv and crowdin values are available.');
            process.exit();
        }

        validateAiProviderFields(options);

        const apiClient = await getCrowdin(options);

        let strings = await getCrowdinStrings({ options, apiClient, spinner });

        let checkResults = {};

        try {
            checkResults = await checkStringsContext({
                apiClient,
                crowdinStrings: strings,
                options,
            });
        } catch (e) {
            console.log('\nError during context check');
            console.error(e);
        }

        try {
            await appendCheckResults(strings, checkResults);
        } catch (error) {
            console.log('\nError during context check');
            console.error(error);
        }

        if (options.output === 'csv') {
            writeCsv(options, strings);
        } else {
            dryRunPrint(strings);
        }
    } catch (error) {
        console.error('error:', error);
    }
}

export default check;