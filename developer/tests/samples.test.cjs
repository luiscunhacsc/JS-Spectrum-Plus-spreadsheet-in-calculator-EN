const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createEmulator } = require('./emulator-harness.cjs');

test('sample catalog embeds all 13 tapes, with friendly names and no missing files', () => {
    const e = createEmulator();
    const catalog = e.evaluate('getSampleCatalog()');
    assert.equal(catalog.length, 13);
    assert.equal(catalog[0].name, 'EXOLON');
    assert.equal(new Set(catalog.map(sample => sample.path)).size, catalog.length);
    for (const sample of catalog) {
        const tape = fs.readFileSync(path.join(__dirname, '..', sample.path));
        assert.deepEqual(Buffer.from(e.evaluate(`decodeBase64ToBytes(EMBEDDED_TAP_BASE64[${JSON.stringify(sample.path)}])`)), tape);
        let offset = 0;
        while (offset < tape.length) {
            assert.ok(offset + 2 <= tape.length, sample.name);
            const size = tape.readUInt16LE(offset);
            assert.ok(size >= 2 && offset + 2 + size <= tape.length, sample.name);
            offset += size + 2;
        }
        assert.equal(offset, tape.length);
    }
});

test('sample menu groups 128K favourites, the music pick, and existing classics', () => {
    const e = createEmulator();
    e.evaluate('renderSamplesMenu()');
    const groups = e.elements.get('sampleSelect').children.filter(el => el.tagName === 'OPTGROUP');
    assert.deepEqual(groups.map(el => el.label), ['128K favourites', 'Music pick', 'More classics']);
    assert.deepEqual(groups.map(el => el.children.length), [6, 1, 6]);
    assert.equal(groups[1].children[0].textContent, 'The NeverEnding Story (128K)');
    const localSource = fs.readFileSync(path.join(__dirname, '../js_spectrum.html'), 'utf8');
    const defaults = /const DEFAULT_SAMPLE_TAPS = (\[[\s\S]*?\n\]);/.exec(localSource)[1];
    e.evaluate(`globalThis.fallbackSamples = ${defaults}`);
    for (const sample of e.evaluate('fallbackSamples')) {
        assert.ok(fs.existsSync(path.join(__dirname, '..', sample.path)), sample.path);
    }
});

test('choosing a sample inserts the embedded tape, preserves the running 128K, and returns keyboard focus', async () => {
    const e = createEmulator(undefined, { audio: true });
    await e.evaluate('loadBuiltIn128K()');
    e.evaluate('globalThis.runningCpu = z80; writeMemory(0x8000, 123);');
    e.click('btnSamples');
    e.elements.get('sampleSelect').value = 'TAPs/Exolon (1987)(Hewson)(48K-128K).tap';
    await e.evaluate('handleSampleSelection()');
    assert.equal(e.evaluate('z80 === runningCpu'), true);
    assert.equal(e.evaluate('readMemory(0x8000)'), 123);
    assert.equal(e.evaluate('tapeBuffer.byteLength'), 42957);
    assert.equal(e.evaluate('tapeIndex'), 0);
    assert.equal(e.evaluate('samplesMenu.hidden'), true);
    assert.equal(e.evaluate('document.activeElement === container'), true);
});

for (const name of ['RoboCop', 'Target: Renegade', 'Head over Heels', 'Cybernoid', 'Cybernoid II: The Revenge', 'The NeverEnding Story (128K)']) {
    const behavior = name.startsWith('The NeverEnding')
        ? 'loads and starts its theme without a continuation key'
        : 'bundled edition loads in 128K';
    test(`${name}: ${behavior}`, async () => {
        const e = createEmulator(undefined, { audio: true });
        await e.evaluate('loadBuiltIn128K()');
        e.frames(200);
        assert.equal(await e.evaluate(`loadSampleTap(getSampleCatalog().find(s => s.name === ${JSON.stringify(name)}))`), true);
        e.key('Enter');
        e.frames(600);
        if (name === 'Head over Heels') {
            e.key('Space');
            e.frames(600);
        }
        assert.equal(e.evaluate('tapeIndex'), e.evaluate('tapeBuffer.byteLength'), 'Tape must load completely');
        assert.equal(e.evaluate('isRunning'), true);
        assert.ok(e.evaluate('z80.getState().sp') >= 0x4000);
        if (name !== 'Head over Heels') {
            e.evaluate(`let audibleFrames = 0; let musicWrites = 0; const original = synthesizeAudioFrame;
                synthesizeAudioFrame = (...args) => {
                    const samples = original(...args);
                    musicWrites += ayLog.filter(event => event.register < 14).length;
                    if (!speakerLog.length && Math.max(...samples) - Math.min(...samples) > 0.01) audibleFrames++;
                    return samples;
                };`);
            e.frames(60);
            assert.ok(e.evaluate('audibleFrames') > 10, 'Expected 128K music');
            assert.ok(e.evaluate('musicWrites') > 10, 'The game must update its AY music registers');
        }
    });
}
