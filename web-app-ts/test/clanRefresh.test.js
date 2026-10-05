const assert = require('node:assert/strict');
const test = require('node:test');
const { createClanRefreshQueue } = require('../public/scripts/clanRefresh');

function setup() {
    const timers = new Map();
    const applied = [];
    const errors = [];
    let timerId = 0;
    const state = { busy: false, loads: 0, load: async () => 'snapshot' };
    const queue = createClanRefreshQueue({
        load: () => { state.loads++; return state.load(); },
        apply: (value) => applied.push(value),
        isBusy: () => state.busy,
        onError: (error) => errors.push(error),
        schedule: (callback) => { timers.set(++timerId, callback); return timerId; },
        cancel: (id) => timers.delete(id)
    });
    const tick = () => {
        const [id, callback] = timers.entries().next().value;
        timers.delete(id);
        return callback();
    };
    return { queue, state, timers, applied, errors, tick };
}

test('bursts produce one refresh and editing defers loading', async () => {
    const h = setup();
    h.state.busy = true;
    h.queue.request();
    h.queue.request();
    await h.tick();
    assert.equal(h.state.loads, 0);
    assert.equal(h.timers.size, 1);
    h.state.busy = false;
    await h.tick();
    assert.deepEqual(h.applied, ['snapshot']);
    assert.equal(h.timers.size, 0);
});

test('an event during a fetch discards stale results and fetches again', async () => {
    const h = setup();
    let resolve;
    h.state.load = () => new Promise((done) => { resolve = done; });
    h.queue.request();
    const loading = h.tick();
    h.queue.request();
    assert.equal(h.timers.size, 0);
    resolve('stale');
    await loading;
    assert.deepEqual(h.applied, []);
    h.state.load = async () => 'latest';
    await h.tick();
    assert.deepEqual(h.applied, ['latest']);
});

test('editing started during a fetch protects the current DOM', async () => {
    const h = setup();
    h.state.load = async () => { h.state.busy = true; return 'snapshot'; };
    h.queue.request();
    await h.tick();
    assert.deepEqual(h.applied, []);
    assert.equal(h.timers.size, 1);
});

test('failed fetch retries without applying and stop cancels the retry', async () => {
    const h = setup();
    h.state.load = async () => { throw new Error('offline'); };
    h.queue.request();
    await h.tick();
    assert.equal(h.errors.length, 1);
    assert.deepEqual(h.applied, []);
    h.state.load = async () => 'recovered';
    await h.tick();
    assert.deepEqual(h.applied, ['recovered']);
    h.queue.request();
    h.queue.stop();
    assert.equal(h.timers.size, 0);
});

test('stop during a fetch prevents DOM replacement', async () => {
    const h = setup();
    h.state.load = async () => { h.queue.stop(); return 'snapshot'; };
    h.queue.request();
    await h.tick();
    assert.deepEqual(h.applied, []);
    assert.equal(h.timers.size, 0);
});
