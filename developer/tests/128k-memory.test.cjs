const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createEmulator } = require('./emulator-harness.cjs');

async function start() {
    const e = createEmulator();
    await e.evaluate('loadBuiltIn128K()');
    return e;
}

test('standalone app exposes only 128K and embeds exactly its two ROMs', async () => {
    const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
    assert.match(html, /id="btnLoad128"/);
    assert.doesNotMatch(html, /id="btnLoad48"|48\.rom|spectrum-48k\.png|<script\b[^>]*\bsrc=/);
    const e = await start();
    assert.deepEqual(Array.from(e.evaluate('Object.keys(EMBEDDED_ROM_BASE64).sort()')), ['128-0.rom', '128-1.rom']);
    assert.equal(e.evaluate('ramBanks.reduce((total, bank) => total + bank.length, 0)'), 128 * 1024);
    assert.equal(e.evaluate('FRAME_TSTATES'), 70908);
    assert.equal(e.evaluate('isRunning'), true);
    assert.equal(e.elements.get('runState').textContent, '128K / RUNNING');
    assert.equal(e.elements.get('screenIdle').hidden, true);
    assert.equal(e.elements.get('btnLoad128').disabled, false);
});

test('paging selects all eight RAM banks and preserves the fixed windows and ROMs', async () => {
    const e = await start();
    const result = e.evaluate(`(() => {
        for (let bank = 0; bank < 8; bank++) {
            writePort(0x7FFD, bank);
            writeMemory(0xC000, bank + 10);
            writeMemory(0xFFFF, bank + 20);
        }
        const banks = [];
        for (let bank = 0; bank < 8; bank++) {
            writePort(0x7FFD, bank);
            banks.push([readMemory(0xC000), readMemory(0xFFFF), readMemory(0x4000), readMemory(0x8000)]);
        }
        const roms = [];
        for (const latch of [0, 0x10]) {
            writePort(0x7FFD, latch);
            const before = readMemory(0);
            writeMemory(0, before ^ 255);
            roms.push(readMemory(0) === before && before === romBanks[latch >> 4][0]);
        }
        writePort(0x7FFD, 2); writeMemory(0xC001, 99);
        const alias2 = readMemory(0x8001);
        writePort(0x7FFD, 5); writeMemory(0x4001, 123);
        return { banks, roms, alias2, alias5: readMemory(0xC001) };
    })()`);
    assert.deepEqual(Array.from(result.banks, row => Array.from(row)),
        Array.from({ length: 8 }, (_, bank) => [bank + 10, bank + 20, 15, 12]));
    assert.deepEqual(Array.from(result.roms), [true, true]);
    assert.equal(result.alias2, 99);
    assert.equal(result.alias5, 123);
});

test('paging lock preserves ROM, RAM and screen selection until reset, while AY stays available', async () => {
    const e = await start();
    e.evaluate(`writePort(0x7FFD, 0x3B); writePort(0x7FFD, 0);
        writePort(0xFFFD, 8); writePort(0xBFFD, 15);`);
    assert.equal(e.evaluate('pagingLatch'), 0x3B);
    assert.equal(e.evaluate('pagingLocked'), true);
    assert.equal(e.evaluate('readPort(0xFFFD)'), 15);
    e.evaluate('resetSystem()');
    assert.equal(e.evaluate('pagingLatch'), 0);
    assert.equal(e.evaluate('pagingLocked'), false);
    e.evaluate('writePort(0x7FFD, 4); writeMemory(0xC000, 77);');
    assert.equal(e.evaluate('readMemory(0xC000)'), 77);
});

test('shadow screen uses bank 7 independently of the CPU RAM window', async () => {
    const e = await start();
    e.evaluate(`ramBanks.forEach(bank => bank.fill(0));
        ramBanks[5][0] = ramBanks[7][0] = 0x80;
        ramBanks[5][0x1800] = 2; ramBanks[7][0x1800] = 4;
        writePort(0x7FFD, 3); renderScreen();`);
    assert.equal(e.evaluate('pixels[0]'), e.evaluate('PALETTE_INT[2]'));
    e.evaluate('writePort(0x7FFD, 0x0B); renderScreen();');
    assert.equal(e.evaluate('pixels[0]'), e.evaluate('PALETTE_INT[4]'));
    assert.equal(e.evaluate('readMemory(0x4000)'), 0x80);
    assert.equal(e.evaluate('getRamBankForAddress(0xC000)'), 3);
});

test('incomplete or invalid custom ROM sets are rejected without changing the running machine', async () => {
    const e = await start();
    e.evaluate('writePort(0x7FFD, 3); writeMemory(0xC000, 77);');
    for (const count of [0, 1, 3]) {
        assert.throws(() => e.evaluate(`loadRomSet(Array.from({ length: ${count} }, () => ({ bytes: new Uint8Array(16384) })))`), /Select both 16 KB ROMs/);
    }
    assert.throws(() => e.evaluate('loadRomSet([{ bytes: new Uint8Array(16384) }, { bytes: new Uint8Array(1) }])'), /exactly 16 KB/);
    await assert.rejects(e.evaluate("readRomFiles([{ name: 'single.rom', arrayBuffer: async () => new Uint8Array(16384).buffer }])"), /Select both 16 KB ROMs/);
    assert.equal(e.evaluate('pagingLatch'), 3);
    assert.equal(e.evaluate('readMemory(0xC000)'), 77);
    assert.equal(e.evaluate('isRunning'), true);
    const roms = await e.evaluate(`readRomFiles([
        { name: '128-1.rom', arrayBuffer: async () => new Uint8Array(16384).fill(1).buffer },
        { name: '128-0.rom', arrayBuffer: async () => new Uint8Array(16384).buffer }
    ])`);
    assert.deepEqual(Array.from(roms, rom => [rom.name, rom.bytes[0]]), [['128-0.rom', 0], ['128-1.rom', 1]]);
});
