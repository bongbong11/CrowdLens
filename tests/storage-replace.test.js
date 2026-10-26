import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceFile } from '../server-plugin/storage.mjs';

test('brief destination lock retries only the atomic file replacement, never deletes the destination', async () => {
    let attempts = 0;
    const delays = [];
    await replaceFile('temp', 'original', async (from, to) => {
        assert.equal(from, 'temp'); assert.equal(to, 'original');
        if (++attempts < 3) throw Object.assign(new Error('locked'), { code: 'EPERM' });
    }, async ms => delays.push(ms));
    assert.equal(attempts, 3); assert.deepEqual(delays, [10, 20]);
});

test('permanent replacement error and exhausted lock retries propagate', async () => {
    for (const code of ['ENOSPC', 'EBUSY']) {
        let attempts = 0;
        await assert.rejects(replaceFile('temp', 'original', async () => { attempts++; throw Object.assign(new Error(code), { code }); }, async () => {}), { code });
        assert.equal(attempts, code === 'ENOSPC' ? 1 : 6);
    }
});
