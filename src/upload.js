//@ts-check
import ora from 'ora';
import { getCrowdin, uploadAiStringsToCrowdin } from './utils.js';
import csv from 'csvtojson';

const spinner = ora();

async function upload(_name, commandOptions, _command) {
    const options = commandOptions.opts();

    spinner.start(`Connecting to Crowdin...`);
    const apiClient = await getCrowdin(options);
    spinner.succeed();

    try {
        spinner.start(`Reading the CSV file...`);
        let strings = await csv().fromFile(options.csvFile);
        spinner.succeed();

        strings = strings.map((row) => {
            return {
                id: row.id,
                context: row.context,
                aiContext: row.aiContext.split('\n').filter((line) => line.trim() !== ''),  // remove empty lines, also uploadAiStringsToCrowdin expects array
            };
        });

        spinner.start(`Uploading the reviewed context to Crowdin...`);
        await uploadAiStringsToCrowdin({
            apiClient,
            project: options.project,
            strings,
        });
        spinner.succeed();

        console.log(`✨ The reviewed context has been uploaded to Crowdin project.`);
    } catch (e) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
    }
}

export default upload;