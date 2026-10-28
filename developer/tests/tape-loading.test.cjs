const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createEmulator } = require('./emulator-harness.cjs');
const exolonTape = process.env.EXOLON_TAP || path.join(__dirname, '../TAPs/Exolon (1987)(Hewson)(48K-128K).tap');

function block(flag, data) {
    const bytes = Buffer.from([flag, ...data, data.reduce((sum, b) => sum ^ b, flag)]);
    const size = Buffer.alloc(2);
    size.writeUInt16LE(bytes.length);
    return Buffer.concat([size, bytes]);
}

async function start() {
    const e = createEmulator(undefined, { audio: true });
    await e.evaluate('loadBuiltIn128K()');
    return e;
}

// Execute through the production frame loop, including the real ROM prologue
// and epilogue. 8000 is a parked caller, with a stack at 9000.
function transfer(e, { entry = 0x0556, flag = 255, load = true, length = 3 } = {}) {
    e.evaluate(`
        pagingLatch = 0x13;
        writeMemory(0x8000, 0xC3); writeMemory(0x8001, 0); writeMemory(0x8002, 0x80);
        writeMemory(0x9000, 0); writeMemory(0x9001, 0x80);
        const s = z80.getState();
        Object.assign(s, { pc: ${entry}, sp: 0x9000, ix: 0xBFFE,
            a: ${flag}, a_prime: ${flag}, d: ${length >> 8}, e: ${length & 255},
            imode: 1, iy: 0x5C3A, iff1: 0, iff2: 0, halted: false, do_delayed_ei: false });
        s.flags.C = s.flags_prime.C = ${load ? 1 : 0};
        z80.setState(s);
    `);
    e.frames(1);
    // If the epilogue enabled interrupts, finish the pending ROM interrupt.
    e.evaluate('for (let n = 0; n < 1000 && z80.getState().pc !== 0x8000; n++) z80.run_instruction();');
    return e.evaluate('z80.getState()');
}

for (const entry of [0x0556, 0x0562]) {
    test(`128K: LOAD via ${entry.toString(16)} preserves the caller and crosses a RAM bank boundary`, async () => {
        const e = await start();
        e.setTape(block(255, [0x31, 0x72, 0xA5]));
        const s = transfer(e, { entry });
        assert.deepEqual(Array.from(e.evaluate('[readMemory(0xBFFE), readMemory(0xBFFF), readMemory(0xC000)]')), [0x31, 0x72, 0xA5]);
        assert.equal(s.pc, 0x8000);
        assert.equal(s.sp, 0x9002);
        assert.equal(s.ix, 0xC001);
        assert.equal((s.d << 8) | s.e, 0);
        assert.equal(s.flags.C, 1);
        assert.equal(s.iff1, entry === 0x0556 ? 1 : 0);
        assert.equal(e.evaluate('ramBanks[3][0]'), 0xA5);
    });
}

test('128K: checksum and flag failures clear carry', async () => {
    for (const failure of ['checksum', 'flag', 'short', 'malformed']) {
        const e = await start();
        const tape = failure === 'malformed' ? Buffer.from([1, 0, 255]) : block(255, [1, 2, 3]);
        if (failure === 'checksum') tape[tape.length - 1] ^= 1;
        e.setTape(tape);
        const s = transfer(e, { flag: failure === 'flag' ? 0 : 255, length: failure === 'short' ? 4 : 3 });
        assert.equal(s.flags.C, 0, failure);
        assert.equal(s.pc, 0x8000, failure);
        if (failure === 'flag' || failure === 'malformed') assert.equal(s.ix, 0xBFFE, failure);
    }
});

test('128K: VERIFY compares memory without overwriting it', async () => {
    for (const matches of [true, false]) {
        const e = await start();
        e.setTape(block(255, [4, 5, 6]));
        e.evaluate(`pagingLatch = 0x13; writeMemory(0xBFFE, 4); writeMemory(0xBFFF, ${matches ? 5 : 99}); writeMemory(0xC000, 6);`);
        const s = transfer(e, { load: false });
        assert.equal(s.flags.C, matches ? 1 : 0);
        assert.equal(e.evaluate('readMemory(0xBFFF)'), matches ? 5 : 99);
    }
});
function loadCommand(e) {
    e.key('KeyJ');
    e.chord(['ShiftLeft', 'KeyP']);
    e.chord(['ShiftLeft', 'KeyP']);
    e.key('Enter');
}

function enter48Basic(e) {
    for (let i = 0; i < 3; i++) e.chord(['ControlLeft', 'Digit6']);
    e.key('Enter');
    e.frames(100);
    assert.equal(e.evaluate('pagingLocked'), true);
}

function basicTestTape() {
    // 10 POKE 32768,123: STOP, auto-started by LOAD "".
    const text = Buffer.from([0xF4, ...Buffer.from('32768'), 0x0E, 0, 0, 0, 128, 0,
        44, ...Buffer.from('123'), 0x0E, 0, 0, 123, 0, 0, 58, 0xE2, 13]);
    const program = Buffer.concat([Buffer.from([0, 10, text.length, 0]), text]);
    const header = Buffer.alloc(17, 0);
    header.write('TAP TEST  ', 1, 'ascii');
    header.writeUInt16LE(program.length, 11);
    header.writeUInt16LE(10, 13);
    header.writeUInt16LE(program.length, 15);
    return Buffer.concat([block(0, header), block(255, program)]);
}

for (const route of ['128K Tape Loader', '128K 48 BASIC']) {
    test(`${route}: boot and auto-run a BASIC tape`, async () => {
        const e = await start();
        e.frames(200);
        if (route.endsWith('48 BASIC')) enter48Basic(e);
        const tape = basicTestTape();
        e.setTape(tape);
        if (route.endsWith('Tape Loader')) e.key('Enter');
        else loadCommand(e);
        e.frames(100);
        assert.equal(e.evaluate('tapeIndex'), tape.length);
        assert.equal(e.evaluate('readMemory(32768)'), 123);
    });

    test(`${route}: EXOLON loads every block and responds to Start`, { skip: !fs.existsSync(exolonTape) }, async () => {
        const e = await start();
        e.frames(200);
        if (route.endsWith('48 BASIC')) enter48Basic(e);
        e.insertTape(exolonTape);
        e.evaluate('let loadedBlocks = 0; const originalLoad = handleTapeLoad; handleTapeLoad = () => { originalLoad(); loadedBlocks++; };');
        if (route.endsWith('Tape Loader')) e.key('Enter');
        else loadCommand(e);
        e.frames(1000);
        e.key('Space');
        e.frames(150);
        assert.equal(e.evaluate('tapeIndex'), fs.statSync(exolonTape).size);
        assert.equal(e.evaluate('loadedBlocks'), 8);
        // Measure actual PCM from EXOLON's menu, with no beeper writes.
        e.evaluate(`let musicFrames = 0; let musicWrites = 0;
            const synth = synthesizeAudioFrame;
            synthesizeAudioFrame = (...args) => {
                const samples = synth(...args);
                musicWrites += ayLog.length;
                if (!speakerLog.length && Math.max(...samples) - Math.min(...samples) > 0.01) musicFrames++;
                return samples;
            };`);
        e.frames(60);
        assert.ok(e.evaluate('musicFrames') > 20);
        assert.ok(e.evaluate('musicWrites') > 100);
        // Reproduce the focus loss reported after clicking the Audio button.
        e.click('btnAudio');
        e.click('btnAudio');
        assert.equal(e.evaluate('document.activeElement === container'), true);
        e.key('Digit3'); // Select keyboard controls, then start using a normal key press.
        e.key('Digit1');
        e.frames(150);
        const game = Buffer.from(e.evaluate('renderScreen(); imgData.data'));
        // Gameplay has a yellow HUD at the bottom; menu stars cannot satisfy this.
        let hudPixels = 0;
        for (let i = 256 * 176 * 4; i < game.length; i += 4) {
            if (game[i] > 100 && game[i + 1] > 100 && game[i + 2] === 0) hudPixels++;
        }
        assert.ok(hudPixels > 100, `Expected gameplay HUD, found ${hudPixels} yellow pixels`);
        assert.ok(e.evaluate('z80.getState().pc') >= 0x4000);

        if (route === '128K Tape Loader') {
            function zoneDigits() {
                const screen = e.evaluate('renderScreen(); imgData.data');
                return [0, 1, 2].map(digit => Buffer.from(Array.from({ length: 64 }, (_, i) => {
                    const offset = ((184 + (i >> 3)) * 256 + 224 + digit * 8 + (i & 7)) * 4;
                    return screen[offset] > 100 && screen[offset + 1] > 100 ? 1 : 0;
                })));
            }
            const firstZone = zoneDigits();
            let nextZone = firstZone;
            // The first screen's turret and rock wall require grenades: hold
            // fire, rather than tapping it for blaster shots, while moving right.
            for (let attempt = 0; attempt < 12 && nextZone[2].equals(firstZone[2]); attempt++) {
                e.chord(['KeyP', 'KeyM'], 40);
                nextZone = zoneDigits();
            }
            assert.deepEqual(nextZone[0], firstZone[0]);
            assert.deepEqual(nextZone[1], firstZone[1]);
            assert.notDeepEqual(nextZone[2], firstZone[2], 'EXOLON must progress beyond zone 000');
        }
    });
}
