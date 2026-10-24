import test from 'node:test';
import assert from 'node:assert/strict';
import { ballsLoaded } from '../../src/core/solid/balls.js';
import { createSession } from '../../src/coop/session.js';
import { fakePair } from './fake-channel.js';

// This file is kept apart (the tests run one process per file) so that the catalog of the balls
// is not loaded when it starts, as on a guest's device that has not played a ball yet.
const BALL = 'surface ball dual-antiprism7\ncheckpoints 3=1 4=2 13=3 12=4\nwalls 0,17,22,27\n'
  + 'path 3 4 5 11 10 9 1 7 8 0 2 13 6 12\n';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('a ball puzzle waits for the catalog of the balls, and so do the messages after', async () => {
  assert.equal(ballsLoaded(), false);
  const wire = fakePair();
  const seen = [];
  createSession({ role: 'guest', channel: wire.b, onEvent: event => seen.push(event.type) });
  wire.a.send(JSON.stringify({ t: 'hello', v: 1 }));
  wire.a.send(JSON.stringify({ t: 'puzzle', text: BALL, seed: 3 }));
  wire.a.send(JSON.stringify({ t: 'start' }));
  wire.flush();
  assert.deepEqual(seen, ['peer']); // the puzzle is on hold, and so is the start behind it
  for (let waited = 0; seen.length < 3 && waited < 5000; waited += 10) {
    await sleep(10);
  }
  assert.deepEqual(seen, ['peer', 'puzzle', 'start']);
  assert.equal(ballsLoaded(), true);
});
