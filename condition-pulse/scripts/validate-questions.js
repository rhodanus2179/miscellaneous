import { readFile } from 'node:fs/promises';

const data = JSON.parse(await readFile(new URL('../data/questions.ja.json', import.meta.url), 'utf8'));
if (!Array.isArray(data.questions) || data.questions.length < 60) throw new Error('Question bank must contain at least 60 questions');
const ids = new Set();
const required = ['id', 'version', 'domain', 'prompt', 'timeBands', 'responseScale', 'direction'];
for (const [index, question] of data.questions.entries()) {
  for (const key of required) {
    if (question[key] === undefined) throw new Error(`Question ${index} is missing ${key}`);
  }
  if (ids.has(question.id)) throw new Error(`Duplicate question id: ${question.id}`);
  ids.add(question.id);
}
console.log(`Validated ${data.questions.length} questions.`);
