// Run: node lib/reacherMap.selfcheck.ts  (Node strips the types natively)
import assert from 'node:assert';
import { fromReacher } from './reacherMap.ts';

assert.equal(fromReacher({ is_reachable: 'safe' }).status, 'valid');
assert.equal(fromReacher({ is_reachable: 'invalid' }).status, 'invalid');
assert.equal(fromReacher({ is_reachable: 'risky' }).status, 'accept-all');
assert.equal(fromReacher({ is_reachable: 'unknown' }).status, 'not found');
assert.equal(fromReacher({}).status, 'not found');
assert.equal(fromReacher({ is_reachable: 'safe' }).creditsLeft, null);

// 'unknown' (throttled) must be flagged inconclusive so BOTH mode falls back to MV;
// clean verdicts must not be.
assert.equal(fromReacher({ is_reachable: 'unknown' }).inconclusive, true);
assert.equal(fromReacher({ is_reachable: 'safe' }).inconclusive, false);
assert.equal(fromReacher({ is_reachable: 'invalid' }).inconclusive, false);

console.log('reacherMap self-check passed');
