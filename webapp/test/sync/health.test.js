import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createHealth, FAILS_BEFORE_NOTICE, RENOTICE_MS,
} from '../../src/platform/sync/health.js';

function setup(options = {}) {
  const told = [];
  const clock = { now: 1_000_000 };
  const state = { online: true };
  const health = createHealth({
    notify: event => told.push(event), now: () => clock.now, online: () => state.online,
    ...options,
  });
  return { health, told, clock, state };
}

test('one failed cloud round is a bad moment, the second in a row is told', () => {
  const { health, told } = setup();
  health.cloudFailed({ error: 'network' });
  assert.deepEqual(told, []);
  health.cloudFailed({ error: 'network' });
  assert.deepEqual(told, [{ kind: 'cloud-failed', code: 'network' }]);
  assert.equal(FAILS_BEFORE_NOTICE, 2);
});

test('a success in between starts the count again', () => {
  const { health, told } = setup();
  health.cloudFailed({});
  health.cloudOk();
  health.cloudFailed({});
  assert.deepEqual(told, []);
});

test('a round the player asked for is told at once', () => {
  const { health, told } = setup();
  health.cloudFailed({ error: 'closed', manual: true });
  assert.deepEqual(told, [{ kind: 'cloud-failed', code: 'closed' }]);
});

test('the same trouble is told once, again after six hours, and recovery says so once', () => {
  const { health, told, clock } = setup();
  for (let i = 0; i < 5; i++) health.cloudFailed({});
  assert.equal(told.length, 1);
  clock.now += RENOTICE_MS - 1;
  health.cloudFailed({});
  assert.equal(told.length, 1);
  clock.now += 2;
  health.cloudFailed({});
  assert.equal(told.length, 2, 'six hours of failing: told again');
  health.cloudOk();
  assert.deepEqual(told.at(-1), { kind: 'cloud-recovered' });
  health.cloudOk();
  assert.equal(told.length, 3, 'no second recovery notice');
});

test('no notice for a failure that was never told, so no recovery notice either', () => {
  const { health, told } = setup();
  health.cloudFailed({});
  health.cloudOk();
  assert.deepEqual(told, []);
});

test('being offline is not a failure: nothing is counted or told', () => {
  const { health, told, state } = setup();
  state.online = false;
  for (let i = 0; i < 6; i++) health.cloudFailed({ manual: true });
  assert.deepEqual(told, []);
  state.online = true;
  health.cloudFailed({});
  assert.deepEqual(told, [], 'the count starts from nothing');
  health.cloudFailed({});
  assert.equal(told.length, 1);
});

test('refusals and too much data are told at once, once per six hours, even offline',
  () => {
    const { health, told, clock, state } = setup();
    state.online = false;
    health.cloudFailed({ error: 'denied' });
    health.cloudFailed({ error: 'denied' });
    assert.deepEqual(told, [{ kind: 'cloud-refused', code: 'denied' }]);
    clock.now += RENOTICE_MS;
    health.cloudFailed({ error: 'rejected' });
    assert.deepEqual(told.at(-1), { kind: 'cloud-refused', code: 'rejected' });
    const other = setup();
    other.health.cloudFailed({ error: 'toobig' });
    other.health.cloudFailed({ error: 'toobig' });
    assert.deepEqual(other.told, [{ kind: 'cloud-toobig', code: 'toobig' }]);
    const unauthorized = setup();
    unauthorized.health.cloudFailed({ error: 'unauthorized' });
    assert.equal(unauthorized.told[0].kind, 'cloud-refused');
  });

test('a failed meeting of linked devices is told after the second in a row', () => {
  const { health, told } = setup();
  health.meetFailed({ reason: 'connect' });
  assert.deepEqual(told, []);
  health.meetFailed({ reason: 'connect' });
  assert.deepEqual(told, [{ kind: 'meet-failed', code: 'connect' }]);
  health.meetFailed({});
  assert.equal(told.length, 1, 'once per episode');
  health.meetOk();
  health.meetFailed({});
  health.meetFailed({});
  assert.equal(told.length, 2, 'a new episode after a success');
});

test('a failed link is told when the card is not on screen, and left to the card '
  + 'when it is', () => {
  const { health, told } = setup();
  health.linkFailed({ reason: 'expired', seen: true });
  assert.deepEqual(told, []);
  health.linkFailed({ reason: 'expired', seen: false });
  health.linkFailed({ reason: 'down' });
  assert.deepEqual(told, [
    { kind: 'link-failed', reason: 'expired' }, { kind: 'link-failed', reason: 'down' }]);
});

test('cloud and meeting troubles are counted apart', () => {
  const { health, told } = setup();
  health.cloudFailed({});
  health.meetFailed({});
  assert.deepEqual(told, []);
  health.cloudFailed({});
  health.meetFailed({});
  assert.deepEqual(told.map(e => e.kind), ['cloud-failed', 'meet-failed']);
});
