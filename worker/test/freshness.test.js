import test from 'node:test';
import assert from 'node:assert/strict';
import { postingAgeDays, checkFreshness } from '../src/freshness.js';
import { matchJob, validateCandidate } from '../src/matcher.js';
import { answerFor } from '../src/answers.js';

const candidate = { roles: ['.NET Developer'], skills: ['C#'], locations: ['Bangalore'], experienceYears: 4.6, minimumMatch: 50 };
test('any advertised experience is eligible without changing screening answers', () => {
  for (const experience of ['0 - 4 years', '9 - 14 years', 'Freshers', '']) {
    assert.equal(matchJob({ title: '.NET Developer', description: 'C#', location: 'Bangalore', experience }, candidate).eligible, true);
  }
  assert.equal(answerFor('Total experience', candidate), '4.6');
});
test('relative posting labels and freshness boundaries', () => {
  for (const [label, days] of [['today',0],['just now',0],['yesterday',1],['Posted: 2 days ago',2],['3+ weeks ago',21],['1 month ago',30],['12 hours ago',0.5]]) assert.equal(postingAgeDays(label), days);
  assert.equal(postingAgeDays('4 - 6 years'), null);
  assert.equal(postingAgeDays('few days ago'), null);
  for (const days of [1,2,3,7,15]) {
    assert.equal(checkFreshness({postedText: days+' days ago'}, days).eligible, true);
    assert.equal(checkFreshness({postedText: (days+1)+' days ago'}, days).eligible, false);
  }
  assert.equal(checkFreshness({}).eligible, false);
  assert.equal(checkFreshness({postedText:'1+ weeks ago'},7).eligible, false);
});
test('freshness accepts only the five supported windows', () => {
  for (const freshnessDays of [1,2,3,7,15]) assert.doesNotThrow(()=>validateCandidate({...candidate,freshnessDays}));
  for (const freshnessDays of [0,4,30,'7']) assert.throws(()=>validateCandidate({...candidate,freshnessDays}));
});
