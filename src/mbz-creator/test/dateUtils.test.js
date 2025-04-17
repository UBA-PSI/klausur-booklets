const { generateAssignmentDates } = require('../lib/dateUtils');

function testOptionA() {
  const opts = {
    firstSubmissionDate: '2025-04-25',
    numConsecutiveWeeks: 3,
    submissionTime: '19:59:59',
    extraTime: 5,
    assignmentNamePrefix: 'Page',
  };
  const assignments = generateAssignmentDates(opts);
  console.log('Option A (firstSubmissionDate + numConsecutiveWeeks):');
  assignments.forEach((a, i) => {
    console.log(`  [${i+1}]`, a);
  });
}

function testOptionB() {
  const opts = {
    submissionDates: '2025-04-25,2025-05-02,2025-05-09',
    submissionTime: '19:59:59',
    extraTime: 5,
    assignmentNamePrefix: 'Page',
  };
  const assignments = generateAssignmentDates(opts);
  console.log('Option B (submissionDates list):');
  assignments.forEach((a, i) => {
    console.log(`  [${i+1}]`, a);
  });
}

function main() {
  testOptionA();
  testOptionB();
}

if (require.main === module) {
  main();
} 