# Crowdin Context Harvester CLI

This tool is especially useful when translating UI projects with Crowdin. The Context Harvester CLI is designed to simplify the process of extracting context for Crowdin strings from your code. Using Large Language Models (LLMs), it automatically analyzes your project code to find out how each key is used. This information is extremely useful for the human linguists or AI that will be translating your project keys, and is likely to improve the quality of the translation.

<div align="center">

[![npm](https://img.shields.io/npm/v/crowdin-context-harvester?logo=npm&cacheSeconds=1800)](https://www.npmjs.com/package/crowdin-context-harvester)
[![npm](https://img.shields.io/npm/dt/crowdin-context-harvester?logo=npm&cacheSeconds=1800)](https://www.npmjs.com/package/crowdin-context-harvester)
[![npm](https://img.shields.io/github/license/crowdin/context-harvester?cacheSeconds=50000)](https://www.npmjs.com/package/crowdin-context-harvester)

</div>

## Demo

[![Crowdin Context Harvester CLI Demo](https://img.youtube.com/vi/7G0PtCElmmI/0.jpg)](https://www.youtube.com/watch?v=7G0PtCElmmI)

## Features

- **Context Extraction**: Pulls keys from your Crowdin project and analyzes your code to extract usage context.
- **LLM Integration**: Utilizes AI for sophisticated context determination.
- **Configuration Flexibility**: The CLI comes with a handy `configure` command to help you get started quickly.
- **CroQL Query Support**: Allows advanced filtering of Crowdin resources.
- **Custom Prompting**: Enables custom prompts for tailored context extraction.
- **Automation or precision**: Automatically save extracted context to Crowdin or review extracted context before saving.

## Installation

```
npm i -g crowdin-context-harvester
```

## Configuration

### Environment Variables

Set the following ENV variables for authentication:

- `CROWDIN_PERSONAL_TOKEN` should be granted for projects and AI scopes;
- `CROWDIN_BASE_URL` - for Crowdin Enterprise only, should follow this format: `https://<org-name>.api.crowdin.com`;
- `CROWDIN_PROJECT_ID` - Crowdin project id;

If you prefer to use OpenAI to extract context you can set following variables:

- `OPENAI_KEY` - OpenAI API key.
- `OPENAI_BASE_URL` - OpenAI-compatible API base URL (optional, defaults to https://api.openai.com/v1).

If you prefer to use Google Gemini (Vertex AI API) to extract context you can set following variables:

- `GOOGLE_VERTEX_PROJECT` - project identifier from Google Cloud Console;
- `GOOGLE_VERTEX_LOCATION` - project location (e.g. us-central1);
- `GOOGLE_VERTEX_CLIENT_EMAIL` - client email of Vertex AI service user;
- `GOOGLE_VERTEX_PRIVATE_KEY` - private key of Vertex AI service user.

If you prefer to use MS Azure OpenAI to extract context you can set following variables:

- `AZURE_RESOURCE_NAME` - MS Azure resource name;
- `AZURE_API_KEY` - MS Azure API key;
- `AZURE_DEPLOYMENT_NAME` - MS Azure deployment name.

If you prefer to use Anthropic to extract context you can set following variables:

- `ANTHROPIC_API_KEY` - Anthropic API key.

If you prefer to use Mistral to extract context you can set following variables:

- `MISTRAL_API_KEY` - Mistral API key.

### Initial Setup

To configure the CLI, run:

```sh
crowdin-context-harvester configure
```

This command will guide you through setting up the necessary parameters for the `harvest` command.

## Usage

After configuration, your command might look like this:

```sh
crowdin-context-harvester harvest\
    --token="<your-crowdin-token>"\
    --url="https://acme.api.crowdin.com"\
    --project=<project-id>\
    --ai="openai"\
    --openAiKey="<your-openai-token>"\
    --openAiBaseUrl="http://localhost:8000/v1"\
    --model="gpt-4o"\
    --crowdinFiles="*.json"\
    --output="csv"\
    --concurrency=10
```

**Note:** The `url` argument is required for Crowdin Enterprise only. The `openAiBaseUrl` argument allows you to use custom OpenAI-compatible endpoints (e.g., local LLMs, third-party APIs). Passing all credentials as environment variables is recommended.

When this command is executed, the CLI will pull strings from all Crowdin files that match the `--crowdinFiles` glob pattern and process them against your repo using built-in search tools.

Extracted context will be saved to the csv file. Add the `--csvFile' argument to change the resulting csv file name.

You can now review the extracted context and save the CSV. After reviewing, you can upload newly added context to Crowdin by running:

```sh
crowdin-context-harvester upload -p <project-id> --csvFile=<csv-file-name>
```

### Generate Project Description

You can generate a concise project description based on your local repository and either print it to the terminal or update the Crowdin project description directly:

```sh
crowdin-context-harvester describe \
    --token="<your-crowdin-token>" \
    --url="https://acme.api.crowdin.com" \
    --project=<project-id> \
    --ai="openai" \
    --openAiKey="<your-openai-token>" \
    --model="gpt-4o" \
    --output=terminal
```

To write the generated description to Crowdin:

```sh
crowdin-context-harvester describe -p <project-id> --output=crowdin
```

### Custom Prompt

Use a custom prompt with:

```sh
crowdin-context-harvester harvest ... arguments ... --promptFile="<path-to-custom-prompt>"
```

or

```sh
cat <path-to-custom-prompt> | crowdin-context-harvester harvest ... arguments ...
```

Example custom prompt file:

```plaintext
Extract the context for the following string.
Context is useful information for linguists working on these texts or for an AI that will translate them.
If none of the strings are relevant (neither keys nor strings are found in the code), do not provide context!
Please only look for exact matches of either a string text or a key in the code, do not try to guess the context!
Any context you provide should start with 'Used as...' or 'Appears as...'.
Always call the return_context function to return the context.

String:
{string}
```

### AI Providers

The CLI currently supports OpenAI, Google Gemini (Vertex AI), MS Azure OpenAI, Anthropic, and Mistral as AI providers. Provide required credentials for context extraction.

### Handling Large Projects

For large projects, consider narrowing `--crowdinFiles` or using `--croql` to reduce scope before invoking the AI provider.

You can also control parallelism with the `--concurrency` (alias `-j`) flag — it defines how many strings are processed concurrently (per‑string extraction). Default is `10`.

Example:

```sh
crowdin-context-harvester harvest ... --concurrency=50
```

### Removing AI Context

To remove previously added AI context, use the reset command:

```sh
crowdin-context-harvester reset
```

## CI / Automation

You can run the Context Harvester in your CI to regularly add or review AI context for strings.

### Environment variables required in CI

- `CROWDIN_PERSONAL_TOKEN` – Crowdin Personal API token with Project and AI scopes
- `CROWDIN_PROJECT_ID` – Crowdin project ID
- `CROWDIN_BASE_URL` – only for Crowdin Enterprise, like `https://<org-name>.api.crowdin.com`
- AI provider credentials (choose one):
  - OpenAI: `OPENAI_KEY` (+ optional `OPENAI_BASE_URL`)
  - Google Vertex: `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION`, `GOOGLE_VERTEX_CLIENT_EMAIL`, `GOOGLE_VERTEX_PRIVATE_KEY`
  - Azure OpenAI: `AZURE_RESOURCE_NAME`, `AZURE_API_KEY`, `AZURE_DEPLOYMENT_NAME`
  - Anthropic: `ANTHROPIC_API_KEY`
  - Mistral: `MISTRAL_API_KEY`

### GitHub Actions

This workflow runs on push to `main`, on a schedule, and manually. It writes context directly to Crowdin using `--output crowdin`.

```yaml
name: Crowdin Context Harvester

on:
  workflow_dispatch:
  schedule:
    - cron: '0 3 * * *' # daily at 03:00 UTC
  push:
    branches: [ main ]

jobs:
  harvest:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Harvest and write AI context to Crowdin
        env:
          CROWDIN_PERSONAL_TOKEN: ${{ secrets.CROWDIN_PERSONAL_TOKEN }}
          CROWDIN_PROJECT_ID: ${{ secrets.CROWDIN_PROJECT_ID }}
          # For Enterprise:
          CROWDIN_BASE_URL: ${{ secrets.CROWDIN_BASE_URL }}
          # AI provider (example: OpenAI)
          OPENAI_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: |
          npx --yes crowdin-context-harvester@latest harvest \
            --project="$CROWDIN_PROJECT_ID" \
            --ai="openai" \
            --model="gpt-5" \
            --croql='not (context contains "✨ AI Context")' \
            --output="crowdin" \
            --concurrency=10
```

### GitLab CI/CD

```yaml
stages: [harvest]

harvest_context:
  image: node:20-alpine
  rules:
    - if: '$CI_PIPELINE_SOURCE == "schedule"'
    - if: '$CI_COMMIT_BRANCH == "main"'
  variables:
    CROWDIN_PERSONAL_TOKEN: "$CROWDIN_PERSONAL_TOKEN"
    CROWDIN_PROJECT_ID: "$CROWDIN_PROJECT_ID"
    # For Enterprise
    CROWDIN_BASE_URL: "$CROWDIN_BASE_URL"
    # AI provider (example: OpenAI)
    OPENAI_KEY: "$OPENAI_API_KEY"
  script:
    - npx --yes crowdin-context-harvester@latest harvest \
        --project="$CROWDIN_PROJECT_ID" \
        --ai="openai" \
        --model="gpt-5" \
        --croql='not (context contains "✨ AI Context")' \
        --output="crowdin" \
        --concurrency=10
```

### Tips for CI runs

- Use `--croql` to limit scope, e.g. only strings without AI context or within a date range. Examples:
  - `--croql='not (context contains "✨ AI Context")'`
  - `--croql="added between '2023-12-06 13:44:14' and '2023-12-07 13:44:14'"`
- Or use `--since "24 hours ago"` to only process recently added strings.
- Set `--output crowdin` to write directly to your Crowdin project, or `--output csv` to review first.
- Adjust `--concurrency` to control API usage; default is `10`.
- For monorepos, run the job from the appropriate subdirectory (set CI working directory) so local code search runs in the right folder.

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
