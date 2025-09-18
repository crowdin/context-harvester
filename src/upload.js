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

    strings = strings.map(row => {
      return {
        id: row.id,
        context: row.context,
        aiContext: typeof row.aiContext === 'undefined' ? undefined : row.aiContext.split('\n').filter(line => line.trim() !== ''), // remove empty lines, also uploadAiStringsToCrowdin expects array
      };
    });

    spinner.start(`Uploading the reviewed context to Crowdin...`);

    const updatedCount = await uploadAiStringsToCrowdin({
      apiClient,
      project: options.project,
      strings,
      uploadAll: typeof strings[0].aiContext === 'undefined',
    });
    spinner.succeed();

    console.log(`✨ The reviewed context has been uploaded to Crowdin project.`);
    console.log(`\n${updatedCount} strings updated in Crowdin.`);
  } catch (e) {
    if (e.message.includes('stringNotExists')) {
      console.error("Some strings wasn't found in project. Please check CSV file and remove excessive strings.");
    } else {
      console.error(`Error: ${e.message}`);
    }
    process.exit(1);
  }
}

export default upload;
