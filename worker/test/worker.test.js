import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreJob } from '../src/matcher.js';
import { answerFor } from '../src/answers.js';
import { shouldSkip } from '../src/history.js';
const candidate = { roles: ['.NET Full Stack Developer'], skills: ['C#', '.NET Core', 'Angular'], locations: ['Bangalore'], experienceYears: 4.6, currentCTC: '10', expectedCTC: '15', noticePeriod: '30 days', answers: { currentLocation: 'Bangalore', willingToRelocate: 'Yes' } };
test('scores a strong matching job', () => assert.equal(scoreJob({ title: '.NET Full Stack Developer', location: 'Bangalore', description: 'C# .NET Core Angular' }, candidate), 100));
test('answers known screening questions', () => { assert.equal(answerFor('What is your current CTC?', candidate), '10'); assert.equal(answerFor('Total years of experience', candidate), '4.6'); assert.equal(answerFor('Are you willing to relocate?', candidate), 'Yes'); assert.equal(answerFor('Unknown certification?', candidate), null); });
test('only skips confirmed applications or uncertain submissions', () => { const url = 'https://www.naukri.com/job-listings-test-123456789012'; assert.equal(shouldSkip([{ url, status: 'DRY_RUN_MATCH' }], url), false); assert.equal(shouldSkip([{ url, status: 'APPLIED' }], url), true); assert.equal(shouldSkip([{ url, status: 'SUBMISSION_UNCONFIRMED' }], url + '?tracking=1'), true); });
