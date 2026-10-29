const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createEmulator } = require('./emulator-harness.cjs');

const sampleRate = 44100;
const dcPole = Math.exp(-2 * Math.PI * 20 / sampleRate);
const lead = 0.04;

function near(actual, expected, tolerance = 1e-8) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be near ${expected}`);
}

function audioOnly() {
    const e = createEmulator(undefined, { audio: true });
    e.evaluate('enableAudio()');
    return e;
}

async function boot() {
    const e = audioOnly();
    await e.evaluate('loadBuiltIn128K()');
    return e;
}

for (const mode of ['128K menu', '48 BASIC']) {
    test(`${mode}: idle scheduled buffers stay exactly silent with delayed frames`, async () => {
        const e = await boot();
        e.frames(200);
        // This app exposes 48 BASIC through the 128K ROM menu.
        if (mode === '48 BASIC') {
            for (let i = 0; i < 3; i++) e.chord(['ControlLeft', 'Digit6']);
            e.key('Enter');
            e.frames(100);
            assert.equal(e.evaluate('pagingLocked && !!(pagingLatch & 0x10)'), true);
        } else {
            assert.equal(e.evaluate('pagingLocked'), false);
        }
        const result = e.evaluate(`(() => {
            let buffers = 0, recoveries = 0, nonzero = 0;
            const recoveryLeads = [];
            for (let repeat = 0; repeat < 4; repeat++) {
                for (const delay of [0.02, 0.016, 0.035, 0.12, 0.02, 0.25, 0.016, 0.04]) {
                    const previousEnd = nextAudioTime;
                    const count = audioCtx.starts.length;
                    audioCtx.currentTime += delay;
                    loop();
                    if (audioCtx.starts.length === count) continue;
                    buffers++;
                    nonzero += audioCtx.lastBuffer.getChannelData(0).filter(value => value !== 0).length;
                    if (previousEnd <= audioCtx.currentTime) {
                        recoveries++;
                        recoveryLeads.push(audioCtx.starts.at(-1) - audioCtx.currentTime);
                    }
                }
            }
            return { buffers, recoveries, nonzero, recoveryLeads };
        })()`);
        assert.ok(result.buffers >= 20);
        assert.ok(result.recoveries >= 8);
        assert.equal(result.nonzero, 0, 'Gaps must interrupt zero, not a DC offset');
        for (const cushion of result.recoveryLeads) near(cushion, lead);
    });
}

for (const [name, speaker, volume, level] of [
    ['held beeper', 1, 0, 1],
    ['constant AY DAC', 0, 15, 0.5],
    ['combined beeper and AY', 1, 15, 1.5]
]) {
    test(`${name}: DC decays continuously across buffers and settles to exact zero`, () => {
        const e = audioOnly();
        const result = e.evaluate(`(() => {
            lastSpeakerState = ${speaker};
            ayChip.write(7, 63);
            for (let channel = 8; channel <= 10; channel++) ayChip.write(channel, ${volume});
            processAudioFrame([]);
            const first = audioCtx.lastBuffer.getChannelData(0).slice();
            processAudioFrame([]);
            const second = audioCtx.lastBuffer.getChannelData(0).slice();
            for (let frame = 0; frame < 12; frame++) processAudioFrame([]);
            const settled = audioCtx.lastBuffer.getChannelData(0).every(value => value === 0);
            lastSpeakerState = 0;
            for (let channel = 8; channel <= 10; channel++) ayChip.write(channel, 0);
            processAudioFrame([]);
            const falling = audioCtx.lastBuffer.getChannelData(0)[0];
            for (let frame = 0; frame < 12; frame++) processAudioFrame([]);
            return { first, second, settled, falling,
                released: audioCtx.lastBuffer.getChannelData(0).every(value => value === 0) };
        })()`);
        near(result.first[0], level);
        near(result.second[0], level * dcPole ** 882);
        near(result.second[0], result.first.at(-1) * dcPole);
        assert.ok(result.first.every(value => value > 0), 'Do not subtract each frame\'s mean');
        assert.equal(result.settled, true);
        near(result.falling, -level);
        assert.equal(result.released, true);
    });
}

test('beeper transitions keep their original amplitude and timing across frame boundaries', () => {
    const e = audioOnly();
    const result = e.evaluate(`(() => {
        const step = FRAME_TSTATES / 882;
        const first = synthesizeAudioFrame([{ t: 100.5 * step, val: 1 }], []);
        const second = synthesizeAudioFrame([{ t: 80.5 * step, val: 0 }], []);
        return { first, second };
    })()`);
    assert.ok(result.first.slice(0, 100).every(value => value === 0));
    assert.equal(result.first[100], 1);
    near(result.second[0], result.first.at(-1) * dcPole);
    near(result.second[79], result.second[78] * dcPole);
    near(result.second[80] - result.second[79] * dcPole, -1, 5e-8);
    const rms = Math.sqrt([...result.first, ...result.second].reduce((sum, value) => sum + value ** 2, 0) / 1764);
    assert.ok(rms > 0.2, 'A legitimate beep must remain audible');
});

test('AY volume writes keep sample timing, including writes just beyond a frame boundary', () => {
    const e = audioOnly();
    const result = e.evaluate(`(() => {
        ayChip.write(7, 63);
        const first = synthesizeAudioFrame([], [
            { t: 100.5 * FRAME_TSTATES / 882, register: 8, value: 15 },
            { t: FRAME_TSTATES + 4, register: 8, value: 0 }
        ]);
        const register = ayChip.registers[8];
        const second = synthesizeAudioFrame([], []);
        return { first, second, register };
    })()`);
    assert.ok(result.first.slice(0, 100).every(value => value === 0));
    near(result.first[100], 1 / 6);
    assert.equal(result.register, 0);
    near(result.second[0], result.first.at(-1) * dcPole - 1 / 6);
    for (let i = 1; i < result.second.length; i++) {
        near(result.second[i], result.second[i - 1] * dcPole, 2e-8); // Float32 rounding.
    }
});

for (const [name, registers] of [
    ['tone', [[0, 100], [7, 62], [8, 15]]],
    ['noise', [[6, 3], [7, 0x37], [8, 15]]],
    ['repeating envelope', [[7, 63], [8, 16], [11, 200], [13, 14]]]
]) {
    test(`filtered AY ${name} remains audible and centered`, () => {
        const e = audioOnly();
        const result = e.evaluate(`(() => {
            for (const [register, value] of ${JSON.stringify(registers)}) ayChip.write(register, value);
            for (let i = 0; i < 12; i++) processAudioFrame([]);
            let sum = 0, squares = 0, count = 0, min = Infinity, max = -Infinity;
            for (let frame = 0; frame < 50; frame++) {
                processAudioFrame([]);
                for (const value of audioCtx.lastBuffer.getChannelData(0)) {
                    sum += value; squares += value * value; count++;
                    min = Math.min(min, value); max = Math.max(max, value);
                }
            }
            return { mean: sum / count, rms: Math.sqrt(squares / count), min, max };
        })()`);
        assert.ok(result.rms > 0.02, `${name} must remain audible`);
        assert.ok(result.min < -0.01 && result.max > 0.01);
        assert.ok(Math.abs(result.mean) < 0.002, `Unexpected DC in ${name}: ${result.mean}`);
    });
}

test('a held AY envelope level settles to silence', () => {
    const e = audioOnly();
    const result = e.evaluate(`(() => {
        ayChip.write(7, 63); ayChip.write(8, 16);
        ayChip.write(11, 2); ayChip.write(13, 13);
        for (let frame = 0; frame < 15; frame++) processAudioFrame([]);
        return { held: ayChip.holding, level: ayChip.envelopeStep ^ ayChip.attack,
            silent: audioCtx.lastBuffer.getChannelData(0).every(value => value === 0) };
    })()`);
    assert.equal(result.held, true);
    assert.equal(result.level, 15);
    assert.equal(result.silent, true);
});

test('scheduling cushions startup and underruns while keeping normal buffers contiguous', () => {
    const e = audioOnly();
    e.evaluate('processAudioFrame([])');
    near(e.evaluate('audioCtx.starts[0]'), lead);
    for (const delay of [0.016, 0.02, 0.035]) {
        const previousEnd = e.evaluate('nextAudioTime');
        e.evaluate(`audioCtx.currentTime += ${delay}; processAudioFrame([])`);
        near(e.evaluate('audioCtx.starts.at(-1)'), previousEnd);
    }
    for (const delay of [0, 0.001, 0.15, 2]) {
        // Equality is also too late: the browser needs a future scheduling cushion.
        e.evaluate(`audioCtx.currentTime = nextAudioTime + ${delay}; processAudioFrame([])`);
        near(e.evaluate('audioCtx.starts.at(-1) - audioCtx.currentTime'), lead);
        near(e.evaluate('nextAudioTime - audioCtx.starts.at(-1)'), 0.02);
        const end = e.evaluate('nextAudioTime');
        e.evaluate('audioCtx.currentTime += 0.02; processAudioFrame([])');
        near(e.evaluate('audioCtx.starts.at(-1)'), end);
    }
});

test('the scheduling cushion preserves 50 Hz CPU pacing on a 60 Hz display', async () => {
    const e = await boot();
    const result = e.evaluate(`(() => {
        const initial = audioCtx.starts.length;
        let maxAhead = 0;
        for (let callback = 0; callback < 120; callback++) {
            audioCtx.currentTime += 1 / 60;
            loop();
            maxAhead = Math.max(maxAhead, nextAudioTime - audioCtx.currentTime);
        }
        return { frames: audioCtx.starts.length - initial, maxAhead };
    })()`);
    assert.ok(result.frames >= 99 && result.frames <= 101, `Expected about 100 CPU frames, got ${result.frames}`);
    assert.ok(result.maxAhead <= 0.06 + 1e-8, 'The queue must not grow with display refresh rate');
});

test('suspended audio keeps executing CPU frames and resumption starts with fresh lead', async () => {
    const e = await boot();
    e.evaluate(`let executedFrames = 0;
        const originalProcessAudioFrame = processAudioFrame;
        processAudioFrame = (...args) => { executedFrames++; originalProcessAudioFrame(...args); };
        audioCtx.state = 'suspended'; nextAudioTime = 100;`);
    const starts = e.evaluate('audioCtx.starts.length');
    e.evaluate('for (let frame = 0; frame < 5; frame++) loop()'); // Audio clock stays frozen.
    assert.equal(e.evaluate('executedFrames'), 5);
    assert.equal(e.evaluate('audioCtx.starts.length'), starts);
    e.evaluate("audioCtx.state = 'running'; loop()");
    assert.equal(e.evaluate('executedFrames'), 6);
    near(e.evaluate('audioCtx.starts.at(-1) - audioCtx.currentTime'), lead);
});

test('reset and ROM replacement clear DC filter history and restart scheduling', async () => {
    const e = await boot();
    for (const reset of ['resetSystem()', 'loadBuiltIn128K()',
        'loadRomSet(romBanks.map(bytes => ({ bytes: bytes.slice() }))); initZ80()']) {
        e.evaluate(`lastSpeakerState = 1; ayChip.write(7, 63); ayChip.write(8, 15);
            ayLog = []; processAudioFrame([]);`);
        assert.ok(e.evaluate('audioCtx.lastBuffer.getChannelData(0).some(value => value > 0.01)'));
        const starts = e.evaluate('audioCtx.starts.length');
        await e.evaluate(reset);
        assert.equal(e.evaluate('audioCtx.starts.length'), starts + 1);
        assert.equal(e.evaluate('audioCtx.lastBuffer.getChannelData(0).every(value => value === 0)'), true);
        near(e.evaluate('audioCtx.starts.at(-1) - audioCtx.currentTime'), lead);
    }
});
