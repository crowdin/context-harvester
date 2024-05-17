# Crowdin Context Harvester CLI

The Crowdin Context Harvester CLI is designed to streamline the process of extracting context for translatable strings in your Crowdin projects. By leveraging Large Language Models (LLMs), it automatically analyzes your project code to determine how each key is used, enhancing the accuracy of translations.

## Features

- **Automated Context Extraction**: Pulls keys from your Crowdin project and analyzes your code to extract usage context.
- **LLM Integration**: Utilizes OpenAI for sophisticated context determination.
- **Configuration Flexibility**: The CLI comes with a handy `configure` command to help you get started quickly.
- **CroQL Query Support**: Allows advanced filtering of Crowdin resources.
- **Custom Prompting**: Enables custom prompts for tailored context extraction.

## Usage

Run the CLI with the following command:

```bash
crowdin-context-harvester harvest\
    --token="<your-crowdin-token>"\
    --org="acme"\
    --project=462\
    --ai="openai"\
    --openAiKey="<your-openai-token>"\
    --model="gpt-4o"\
    --localFiles="test-data/*.*"\
    --localIgnore="node_modules/**"\
    --crowdinFiles="*.json"\
    --screen="keys"\
    --dryRun
```

## Configuration

### Environment Variables

Set the following ENV variables for authentication:

 - `CROWDIN_TOKEN` should be granted for projects and AI scopes;
 - `CROWDIN_ORG`  - for Crowdin Enterprise only. Example value: 'acme';
 - `OPENAI_KEY` - when using OpenAI for AI context extraction;
  
### Initial Setup

To configure the CLI, run:

```sh
crowdin-context-harvester configure
```

This command will guide you through setting up the necessary parameters for the `harvest` command.

### Running in Dry Run Mode
It's recommended to run the command in dry run mode first:

```sh
crowdin-context-harvester harvest ... arguments ... --dryRun
```

This previews the suggested AI contexts without making any changes in Crowdin.

### Custom Prompt

Use a custom prompt with:

```sh
crowdin-context-harvester harvest ... arguments ... --promptFile="<path-to-custom-prompt>"
```

Example custom prompt file:

```plaintext
Extract the context for the following strings. 
Context is useful information for linguists working on these texts or for an AI that will translate them.
If none of the strings are relevant (neither keys nor strings are found in the code), do not provide context!
Please only look for exact matches of either a string text or a key in the code, do not try to guess the context!
Any context you provide should start with 'Used as...' or 'Appears as...'.
Always call the setContext function to return the context.

Strings:
%strings%

Code:
%code%
```

### AI Providers
The CLI currently supports the OpenAI AI provider. Provide an OpenAI API key or a Crowdin provider ID for context extraction.

### Handling Large Projects

For large projects, use the `--screen` option to filter keys or texts before sending them to the AI model:

```sh
crowdin-context-harvester harvest ... arguments ... --screen="keys"
```

### Removing AI Context
To remove previously added AI context, use the reset command:

```sh
crowdin-context-harvester reset
```

## About Crowdin
Crowdin is a platform that helps you manage and translate content into different languages. Integrate Crowdin with your repo, CMS, or other systems. Source content is always up to date for your translators, and translated content is returned automatically.

## License
<pre>
The Crowdin Context Harvester CLI is licensed under the MIT License. 
See the LICENSE file distributed with this work for additional 
information regarding copyright ownership.

Except as contained in the LICENSE file, the name(s) of the above copyright
holders shall not be used in advertising or otherwise to promote the sale,
use or other dealings in this Software without prior written authorization.
</pre>