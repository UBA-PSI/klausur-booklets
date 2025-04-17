#!/usr/bin/env node

const { createMoodleBackup } = require('./mbzCreator');
const path = require('path');

function printUsage() {
  console.log(`\nUsage: node cli.js <input_mbz> [options]\n
Options:
  -o, --output-mbz <file>           Output MBZ file path
  --first-submission-date <date>    Date of the first assignment (YYYY-MM-DD)
  --num-consecutive-weeks <n>       Number of consecutive weeks
  --submission-dates <dates>        Comma-separated list of assignment dates (YYYY-MM-DD,...)
  --submission-time <time>          Time for submissions (default: 23:59:59)
  --extra-time <minutes>            Minutes between due and cutoff (default: 60)
  --section-title <title>           Section title in Moodle
  --assignment-name-prefix <prefix> Prefix for assignment names (default: 'Page')
  --target-start-date <date>        Target course start date (YYYY-MM-DD)
`);
}

function parseArgs(argv) {
  const options = {};
  let i = 2;
  if (argv.length < 3) {
    printUsage();
    process.exit(1);
  }
  options.inputMbz = argv[i++];
  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case '-o':
      case '--output-mbz':
        options.outputMbz = argv[++i];
        break;
      case '--first-submission-date':
        options.firstSubmissionDate = argv[++i];
        break;
      case '--num-consecutive-weeks':
        options.numConsecutiveWeeks = parseInt(argv[++i], 10);
        break;
      case '--submission-dates':
        options.submissionDates = argv[++i];
        break;
      case '--submission-time':
        options.submissionTime = argv[++i];
        break;
      case '--extra-time':
        options.extraTime = parseInt(argv[++i], 10);
        break;
      case '--section-title':
        options.sectionTitle = argv[++i];
        break;
      case '--assignment-name-prefix':
        options.assignmentNamePrefix = argv[++i];
        break;
      case '--target-start-date':
        options.targetStartDate = argv[++i];
        break;
      default:
        console.log(`Unknown argument: ${arg}`);
        printUsage();
        process.exit(1);
    }
    i++;
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv);
  console.log('Parsed options:', options);
  // TODO: Call createMoodleBackup(options) when implemented
  // await createMoodleBackup(options);
}

if (require.main === module) {
  main();
} 