/**
 * Seeds a few polls so the web app has something to show on first run.
 * Safe to re-run: it skips seeding if the database already has polls.
 * Usage: npm run seed
 */
import * as polls from '../src/services/pollService.js';
import * as repo from '../src/repositories/pollRepository.js';
import { config } from '../src/config.js';

const existing = repo.listPolls({ limit: 1 });
if (existing.length > 0) {
  console.log(`${config.databaseFile} already has polls -- nothing seeded.`);
  process.exit(0);
}

const live = [
  {
    question: 'Who wins the toss?',
    match_name: 'India vs Australia · 2nd ODI',
    options: ['India', 'Australia'],
  },
  {
    question: 'Top scorer in this innings?',
    match_name: 'India vs Australia · 2nd ODI',
    options: ['Rohit Sharma', 'Shubman Gill', 'Virat Kohli', 'KL Rahul'],
  },
  {
    question: 'How many runs off this over?',
    match_name: 'India vs Australia · 2nd ODI',
    options: ['0-4', '5-9', '10-14', '15+'],
  },
];

const closed = {
  question: 'Man of the match?',
  match_name: 'India vs England · 1st T20',
  options: ['Jos Buttler', 'Hardik Pandya', 'Jasprit Bumrah'],
};

for (const poll of live) {
  const created = polls.createPoll(poll);
  console.log(`live    ${created.id}  ${created.question}`);
}

const finished = polls.createPoll(closed);
// A handful of votes so the history page is not empty.
finished.options.forEach((option, index) => {
  for (let voter = 0; voter < (index + 1) * 3; voter += 1) {
    polls.castVote({
      pollId: finished.id,
      channel: 'web',
      context: { voterId: `seed-${option.id}-${voter}`, optionId: option.id },
    });
  }
});
polls.closePoll(finished.id);
console.log(`closed  ${finished.id}  ${finished.question}`);
console.log(`\nSeeded ${config.databaseFile}`);
