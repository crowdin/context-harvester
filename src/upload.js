import ora from 'ora';
import { getCrowdin, uploadAiStringsToCrowdin } from './utils.js';
import csv from 'csvtojson';

const spinner = ora();

async function upload(name, commandOptions, command) {
    const options = commandOptions.opts();

    spinner.start(`Connecting to Crowdin...`);
    const apiClient = await getCrowdin(options);
    spinner.succeed();

    try {
        spinner.start(`Reading the CSV file...`);
        let data = await csv().fromFile(options.csvFile);
        spinner.succeed();

        data = data.map((row) => {
            return {
                id: row.id,
                context: row.context,
                aiContext: row.aiContext.split('\n').filter((line) => line.trim() !== ''),  // remove empty lines, also uploadAiStringsToCrowdin expects array
            };
        });

        spinner.start(`Uploading the reviewed context to Crowdin...`);
        await uploadAiStringsToCrowdin(apiClient, options.project, data);
        spinner.succeed();

        console.log(`✨ The reviewed context has been uploaded to Crowdin project.`);
    } catch (e) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
    }
}

export default upload;