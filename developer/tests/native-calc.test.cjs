const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createEmulator } = require('./emulator-harness.cjs');
const program = require('../native-calc/program.json');
const source = fs.readFileSync(path.join(__dirname, '../native-calc/calc.c'), 'utf8');
const glyphs = [...source.slice(source.indexOf('const unsigned char glyphs'), source.indexOf('extern void character')).matchAll(/\{([\d,]+)\}/g)]
    .map(match => match[1].split(',').map(Number));
const font = new Map(glyphs.map((glyph, i) => [glyph.join(','), String.fromCharCode(i + 32)]));

async function start() {
    const e = createEmulator();
    await e.evaluate('loadBuiltIn128K()'); e.frames(200);
    e.key('ArrowDown'); e.key('ArrowDown'); e.key('Enter'); e.frames(100);
    assert.equal(e.evaluate('!!nativeCalcContext'), true);
    assert.equal(e.evaluate(`readMemory(${program.ready})`), 1);
    return e;
}
function bytes(e, address, length) {
    return Array.from(e.evaluate(`Array.from({length:${length}},(_,i)=>readMemory(${address}+i))`));
}
function rawCell(e, row, col) {
    return String.fromCharCode(...bytes(e, program.cells + (row * 8 + col) * 32, 32)).split('\0')[0];
}
function screenLine(e, row) {
    const bitmap = bytes(e, 0x4000, 6144);
    return Array.from({ length: 64 }, (_, col) => {
        const glyph = Array.from({ length: 5 }, (_, line) => {
            const addr = ((row & 24) << 8) + ((row & 7) << 5) + (col >> 1) + (line + 1) * 256;
            return ((bitmap[addr] >> (col & 1 ? 0 : 4)) & 15) >> 1;
        });
        return font.get(glyph.join(',')) || '?';
    }).join('');
}
function literal(e, ch) {
    const code = /[a-z]/i.test(ch) ? 'Key' + ch.toUpperCase() : /\d/.test(ch) ? 'Digit' + ch : 'Text' + ch;
    e.evaluate(`window.dispatchEvent({type:'keydown',key:${JSON.stringify(ch)},code:${JSON.stringify(code)},preventDefault(){}});`);
    e.frames(20);
    e.evaluate(`window.dispatchEvent({type:'keyup',key:${JSON.stringify(ch)},code:${JSON.stringify(code)},preventDefault(){}});`);
    e.frames(20);
}
function entry(e, text) { for (const ch of text) literal(e, ch); e.key('Enter', 15); e.frames(60); }
function move(e, key) { e.key(key, 15); e.frames(20); }
function setCells(e, cells) {
    for (const [ref, text] of Object.entries(cells)) {
        const match = /^([A-H])(\d+)$/.exec(ref);
        const address = program.cells + ((Number(match[2]) - 1) * 8 + match[1].charCodeAt(0) - 65) * 32;
        const values = Array.from({ length: 32 }, (_, i) => text.charCodeAt(i) || 0);
        e.evaluate(`${JSON.stringify(values)}.forEach((value,i)=>writeMemory(${address}+i,value));`);
    }
}
function recalculate(e) {
    // Call the compiled, parameterless C routine on the actual Z80. A parked
    // caller lets us check RAM results without implementing maths in JS.
    e.evaluate(`{ writeMemory(0x5B00,0xC3); writeMemory(0x5B01,0); writeMemory(0x5B02,0x5B);
        writeMemory(0xFE00,0); writeMemory(0xFE01,0x5B);
        const state=z80.getState(); Object.assign(state,{pc:${program.recalculate},sp:0xFE00,iff1:0,iff2:0,halted:false}); z80.setState(state); }`);
    for (let frame = 0; frame < 300 && e.evaluate('z80.getState().pc') !== 0x5B00; frame++) e.frames(1);
    assert.equal(e.evaluate('z80.getState().pc'), 0x5B00, 'Native recalculation must terminate');
}
function value(e, row, col) {
    const id = row * 8 + col;
    const slot = id & (program.cacheSlots - 1);
    const cached = bytes(e, program.cacheIds + slot * 2, 2);
    assert.equal(cached[0] | (cached[1] << 8), id, 'The native result must be present in its cache slot');
    const b = bytes(e, program.values + slot * 6, 6);
    if (!b[5]) return 0;
    const mantissa = b.slice(0, 5).reduce((sum, v, i) => sum + (i === 4 ? v & 127 : v) * 2 ** (8 * i), 0);
    return (b[4] & 128 ? -1 : 1) * (1 + mantissa / 2 ** 39) * 2 ** (b[5] - 129);
}
function key(e, code) { e.key(code,20); e.frames(50); }
function selectCell(e, row, col) {
    while (bytes(e, program.row, 1)[0] < row) key(e,'ArrowDown');
    while (bytes(e, program.row, 1)[0] > row) key(e,'ArrowUp');
    while (bytes(e, program.col, 1)[0] < col) key(e,'ArrowRight');
    while (bytes(e, program.col, 1)[0] > col) key(e,'ArrowLeft');
}
function pointer(e,type,x,y) {
    const screen=e.elements.get('screen');
    const r=screen.getBoundingClientRect();
    screen.dispatchEvent({type,button:0,pointerId:1,clientX:r.left+x*r.width/256,clientY:r.top+y*r.height/192});
    e.frames(90);
}
function clickScreen(e,x,y) {
    pointer(e,'pointerdown',x,y); pointer(e,'pointerup',x,y);
}

test('native toolbar and formula bar support editing, cancellation, saving and clearing with the mouse', async () => {
    const e=await start();
    entry(e,'42'); key(e,'ArrowUp');
    clickScreen(e,20,28);
    assert.equal(bytes(e,program.editing,1)[0],1);
    assert.match(screenLine(e,3),/SAVE.*CANCEL/);
    literal(e,'9');
    clickScreen(e,64,28);
    assert.equal(bytes(e,program.editing,1)[0],0);
    assert.equal(rawCell(e,0,0),'42','Cancel preserves the original cell');
    clickScreen(e,120,12);
    assert.equal(bytes(e,program.editing,1)[0],1);
    literal(e,'7'); clickScreen(e,20,28);
    assert.equal(rawCell(e,0,0),'427');
    assert.equal(bytes(e,program.row,1)[0],1,'Save follows Enter and moves down');
    clickScreen(e,42,44); clickScreen(e,64,28);
    assert.equal(rawCell(e,0,0),'');
    assert.equal(bytes(e,program.editing,1)[0],0);
});

test('clicking the selected cell edits it and selecting another cell commits the edit', async () => {
    const e=await start();
    clickScreen(e,42,44);
    assert.equal(bytes(e,program.editing,1)[0],1);
    literal(e,'5');
    clickScreen(e,98,52);
    assert.equal(rawCell(e,0,0),'5');
    assert.equal(bytes(e,program.editing,1)[0],0);
    assert.equal(bytes(e,program.row,1)[0],1);
    assert.equal(bytes(e,program.col,1)[0],1);
    assert.equal(bytes(e,0x5800+4*32+9,1)[0],104,'The selected column header follows the cell');
    assert.equal(bytes(e,0x5800+6*32,1)[0],104,'The selected row header follows the cell');
});

test('native help accepts mouse and Escape, and toolbar Exit preserves the sheet', async () => {
    const e=await start(); entry(e,'5');
    clickScreen(e,170,28);
    assert.equal(bytes(e,program.helpActive,1)[0],1);
    assert.match(screenLine(e,0),/AVAILABLE FORMULAS/);
    clickScreen(e,42,44);
    assert.equal(bytes(e,program.helpActive,1)[0],1,'The sheet is inactive behind help');
    clickScreen(e,80,188);
    assert.equal(bytes(e,program.helpActive,1)[0],0);
    key(e,'F4'); key(e,'Escape');
    assert.equal(bytes(e,program.helpActive,1)[0],0);
    assert.equal(e.evaluate('!!nativeCalcContext'),true);
    clickScreen(e,225,28);
    assert.equal(e.evaluate('nativeCalcContext'),null);
    e.key('ArrowDown'); e.key('ArrowDown'); e.key('Enter'); e.frames(100);
    assert.equal(rawCell(e,0,0),'5');
});

test('mouse copy selects destinations across pages and warns before replacing cells', async () => {
    const e=await start();
    setCells(e,{A16:'=B16*2',B17:'3',B18:'4',A17:'99'});
    clickScreen(e,42,164); clickScreen(e,118,28);
    assert.equal(bytes(e,program.fillMode,1)[0],1);
    assert.match(screenLine(e,22),/REPLACES DESTINATION/);
    clickScreen(e,215,172);
    assert.equal(bytes(e,program.top,1)[0],16);
    clickScreen(e,42,52);
    assert.equal(bytes(e,program.fillRow,1)[0],17);
    assert.match(screenLine(e,22),/REPLACES DESTINATION/);
    clickScreen(e,20,28);
    assert.equal(bytes(e,program.fillMode,1)[0],0);
    assert.equal(rawCell(e,16,0),'=B17*2');
    assert.equal(rawCell(e,17,0),'=B18*2');
    assert.equal(value(e,17,0),8);
    clickScreen(e,118,28); clickScreen(e,42,60); clickScreen(e,64,28);
    assert.equal(bytes(e,program.fillMode,1)[0],0);
    assert.equal(rawCell(e,18,0),'','Cancel leaves the destination untouched');
});

test('clickable page controls stay inside A1:H64', async () => {
    const e=await start();
    clickScreen(e,150,172); clickScreen(e,4,172);
    assert.equal(bytes(e,program.row,1)[0],0); assert.equal(bytes(e,program.col,1)[0],0);
    for(let i=0;i<5;i++) clickScreen(e,215,172);
    for(let i=0;i<3;i++) clickScreen(e,36,172);
    assert.equal(bytes(e,program.row,1)[0],63); assert.equal(bytes(e,program.col,1)[0],7);
    assert.equal(bytes(e,program.top,1)[0],48); assert.equal(bytes(e,program.left,1)[0],4);
    assert.match(screenLine(e,21),/E-H.*49-64\/64/);
});

test('Calculator runs a blank Z80 application in video RAM, with no external spreadsheet UI', async () => {
    const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
    assert.doesNotMatch(html, /sheetDialog|SpectrumSpreadsheet|spreadsheet\.js|btnSpreadsheet/);
    const e = await start();
    assert.equal(e.evaluate('isRunning'), true);
    assert.ok(e.evaluate('z80.getState().pc') >= program.origin);
    assert.match(screenLine(e, 0), /SPECTRUM CALC/);
    assert.equal(rawCell(e, 0, 0), '');
    assert.equal(rawCell(e, 63, 7), '');
    assert.equal(bytes(e, 0x5800 + 5 * 32 + 2, 1)[0], 104, 'Active cell is highlighted in Spectrum attribute RAM');
});

test('cell contents have a character of breathing room from the grid borders', async () => {
    const e = await start();
    assert.match(screenLine(e, 5), /^  1/);
    assert.match(screenLine(e, 2), /^ VALUE/);
    assert.match(screenLine(e, 22), /^ CLICK OR TYPE/);
    assert.match(screenLine(e, 23), /^ ENTER EDIT/);
    entry(e, '42');
    const numericCell = screenLine(e, 5).slice(4, 18);
    assert.equal(numericCell, '          42  ');
    entry(e, 'LABEL');
    const textCell = screenLine(e, 6).slice(4, 18);
    assert.equal(textCell, ' LABEL        ');
});

test('real keyboard entry calculates quantity, price, multiplication and a final SUM on the Z80 screen', async () => {
    const e = await start();
    entry(e, '3'); move(e, 'ArrowUp'); move(e, 'ArrowRight');
    entry(e, '2,50'); move(e, 'ArrowUp'); move(e, 'ArrowRight');
    entry(e, '=A1*B1');
    assert.equal(rawCell(e, 0, 2), '=A1*B1');
    assert.ok(Math.abs(value(e, 0, 2) - 7.5) < 1e-8);
    assert.match(screenLine(e, 5), /7\.5/);
    entry(e, '=SUM(C1:C1)');
    assert.equal(rawCell(e, 1, 2), '=SUM(C1:C1)');
    assert.ok(Math.abs(value(e, 1, 2) - 7.5) < 1e-8);
    assert.match(screenLine(e, 6), /7\.5/);
});

test('compiled formula engine recalculates dependencies, parentheses, decimals, rectangular sums and text cells', async () => {
    const e = await start();
    setCells(e, { A1:'3', B1:'2.50', C1:'=A1*B1', A2:'2', B2:'4,75', C2:'=A2*B2',
        A3:'QUANTIDADE', B3:'=-(B1+1)/2', C3:'=SUM(C1:C2)', D3:'=SUM(B2:A1)', H64:'=$C$3+1' });
    recalculate(e);
    assert.ok(Math.abs(value(e, 0, 2) - 7.5) < 1e-8);
    assert.ok(Math.abs(value(e, 1, 2) - 9.5) < 1e-8);
    assert.ok(Math.abs(value(e, 2, 2) - 17) < 1e-8);
    assert.ok(Math.abs(value(e, 2, 1) + 1.75) < 1e-8);
    assert.ok(Math.abs(value(e, 2, 3) - 12.25) < 1e-8);
    assert.ok(Math.abs(value(e, 63, 7) - 18) < 1e-8);
    setCells(e, { A1:'4' }); recalculate(e);
    assert.ok(Math.abs(value(e, 2, 2) - 19.5) < 1e-8);
});

test('native formula errors include cycles, invalid references, division by zero and syntax, and recover after edits', async () => {
    const e = await start();
    setCells(e, { A1:'=1/0', B1:'=Z1', C1:'=(2+', D1:'=A65', E1:'=F1', F1:'=E1', G1:'=SUM(E1:F1)', H1:'=1+2*3' });
    recalculate(e);
    assert.deepEqual(bytes(e, program.errors, 8), [3,2,1,2,4,4,4,0]);
    assert.equal(value(e, 0, 7), 7);
    setCells(e, { F1:'5' }); recalculate(e);
    assert.equal(value(e, 0, 4), 5);
    assert.equal(value(e, 0, 6), 10);
});

test('leaving and reopening Calculator preserves native cells and restores the Spectrum menu and RAM', async () => {
    const e = await start();
    const before = e.evaluate('nativeCalcContext.banks[2][0x1000]');
    entry(e, '42');
    e.key('Escape', 20); e.frames(100);
    assert.equal(e.evaluate('nativeCalcContext'), null);
    assert.equal(e.evaluate('readMemory(0x9000)'), before);
    assert.equal(e.evaluate('isRunning'), true);
    e.key('ArrowDown'); e.key('ArrowDown'); e.key('Enter'); e.frames(100);
    assert.equal(rawCell(e, 0, 0), '42');
    assert.match(screenLine(e, 5), /42/);
    e.key('Escape', 20); e.frames(100);
    e.key('ArrowDown'); e.key('ArrowDown'); e.key('ArrowDown'); e.key('Enter'); e.frames(100);
    assert.equal(e.evaluate('pagingLocked'), true, '48 BASIC remains available from the restored menu');
});

test('portable TAP boots through the real Tape Loader without the calculator launch hook', async () => {
    const e = createEmulator(); await e.evaluate('loadBuiltIn128K()'); e.frames(200);
    e.evaluate('calculatorHookSupported=false');
    e.insertTape(path.join(__dirname, '../native-calc/spectrum-calc.tap'));
    e.key('Enter'); e.frames(500);
    assert.equal(e.evaluate('nativeCalcContext'), null);
    assert.equal(e.evaluate('tapeIndex'), e.evaluate('tapeBuffer.byteLength'));
    assert.equal(e.evaluate(`readMemory(${program.ready})`), 1);
    assert.match(screenLine(e, 0), /SPECTRUM CALC/);
    setCells(e,{A1:'=B1*2'});
    e.chord(['ShiftLeft','KeyF'],20); e.frames(60);
    assert.equal(bytes(e,program.fillMode,1)[0],1,'The portable program accepts real Symbol Shift + F');
    key(e,'ArrowDown'); key(e,'Enter'); e.frames(100);
    assert.equal(rawCell(e,1,0),'=B2*2');
    assert.equal(e.evaluate('nativeCalcContext'),null);
});

test('native cursor navigation scrolls to later rows and columns within the Spectrum display', async () => {
    const e = await start();
    for (let i = 0; i < 16; i++) move(e, 'ArrowDown');
    e.frames(100);
    assert.equal(bytes(e, program.row, 1)[0], 16);
    assert.equal(bytes(e, program.top, 1)[0], 16);
    for (let i = 0; i < 4; i++) move(e, 'ArrowRight');
    e.frames(100);
    assert.equal(bytes(e, program.col, 1)[0], 4);
    assert.equal(bytes(e, program.left, 1)[0], 4);
    assert.match(screenLine(e, 4), /E\s+F\s+G\s+H/);
    assert.match(screenLine(e, 5), /^ 17/);
});

test('English aggregate functions handle numbers, text, blanks, negative values and empty ranges', async () => {
    const e=await start();
    setCells(e,{ A1:'-3',A2:'2.5',A3:'LABEL',A4:' ',A5:'6',
        B1:'=SUM(A1:A5)',B2:'=AVERAGE(A1:A5)',B3:'=MIN(A1:A5)',B4:'=MAX(A1:A5)',B5:'=COUNT(A1:A5)',
        C1:'=SOMA(A1:A5)',D1:'=SUM(H1:H5)',D2:'=AVERAGE(H1:H5)',D3:'=MIN(H1:H5)',D4:'=MAX(H1:H5)',D5:'=COUNT(H1:H5)' });
    recalculate(e);
    assert.ok(Math.abs(value(e,0,1)-5.5)<1e-8);
    assert.ok(Math.abs(value(e,1,1)-5.5/3)<1e-8);
    assert.equal(value(e,2,1),-3); assert.equal(value(e,3,1),6); assert.equal(value(e,4,1),3);
    assert.equal(bytes(e,program.errors+2,1)[0],7,'Portuguese function names are no longer accepted');
    assert.equal(value(e,0,3),0); assert.equal(value(e,2,3),0); assert.equal(value(e,3,3),0); assert.equal(value(e,4,3),0);
    assert.equal(bytes(e,program.errors+11,1)[0],3,'An empty AVERAGE reports division by zero');
});

test('the native cache handles colliding dependencies and COUNT counts more than 255 cells', async () => {
    const e=await start();
    setCells(e,{ A1:'3',A9:'=A1+1',A17:'=A9+1',H64:'=A1+A9+A17' });
    recalculate(e); assert.equal(value(e,63,7),12);
    const all={}; for(let r=1;r<=63;r++) for(const c of 'ABCDEFGH') all[c+r]='1';
    all.H64='=COUNT(A1:H63)'; setCells(e,all); recalculate(e);
    assert.equal(value(e,63,7),504);
});

test('SS+E has a single hint and opens a native page listing every supported English function', async () => {
    const e=await start();
    assert.equal((Array.from({length:24},(_,r)=>screenLine(e,r)).join('\n').match(/SS\+E/g)||[]).length,1);
    key(e,'F4'); e.frames(100);
    assert.match(screenLine(e,0),/AVAILABLE FORMULAS/);
    ['SUM','AVERAGE','MIN','MAX','COUNT'].forEach((name,i)=>assert.match(screenLine(e,4+i*2),new RegExp('^'+name+'\\s')));
    assert.match(screenLine(e,16),/\$A\$2/);
    key(e,'Enter'); e.frames(100); assert.match(screenLine(e,0),/SPREADSHEET/);
});

test('keyboard fill adjusts relative, absolute and mixed references and both ends of ranges', async () => {
    const e=await start();
    setCells(e,{ C2:'=$A2+B$1+$C$1+SUM(D2:E3)' }); selectCell(e,1,2);
    key(e,'F5'); key(e,'ArrowDown'); key(e,'ArrowRight'); key(e,'Enter'); e.frames(100);
    assert.equal(rawCell(e,1,2),'=$A2+B$1+$C$1+SUM(D2:E3)');
    assert.equal(rawCell(e,1,3),'=$A2+C$1+$C$1+SUM(E2:F3)');
    assert.equal(rawCell(e,2,2),'=$A3+B$1+$C$1+SUM(D3:E4)');
    assert.equal(rawCell(e,2,3),'=$A3+C$1+$C$1+SUM(E3:F4)');
    assert.equal(bytes(e,program.fillMode,1)[0],0);
});

test('keyboard fill is atomic on length overflow, reports invalid references, and can be cancelled', async () => {
    const e=await start();
    const long='=A9+A9+A9+A9+A9+A9+A9+A9+A9+A9';
    setCells(e,{ A1:long,B1:'KEEP',A2:'99' });
    key(e,'F5'); key(e,'ArrowRight'); key(e,'ArrowDown'); key(e,'Enter'); e.frames(80);
    assert.equal(rawCell(e,0,1),'KEEP'); assert.equal(rawCell(e,1,0),'99');
    assert.match(screenLine(e,22),/31 CHARACTERS/);
    selectCell(e,0,0); setCells(e,{ A1:'=H64' });
    key(e,'F5'); key(e,'ArrowRight'); key(e,'Enter'); e.frames(80);
    assert.equal(rawCell(e,0,1),'=#REF!'); assert.equal(bytes(e,program.errors+1,1)[0],2);
    selectCell(e,0,0); key(e,'F5'); key(e,'ArrowDown'); key(e,'Escape');
    assert.equal(rawCell(e,1,0),'99'); assert.equal(bytes(e,program.fillMode,1)[0],0);
    assert.equal(e.evaluate('!!nativeCalcContext'),true);
});

test('dragging the native fill handle copies formulas through Kempston mouse input on a scaled display', async () => {
    const e=await start();
    e.elements.get('screen').getBoundingClientRect=()=>({left:100,top:50,width:768,height:576});
    setCells(e,{ A2:'3',B2:'2.5',C2:'=A2*B2',A3:'4',B3:'1.5',A4:'2',B4:'5',A5:'2',B5:'5' });
    pointer(e,'pointerdown',154,52); pointer(e,'pointerup',154,52);
    assert.equal(bytes(e,program.row,1)[0],1); assert.equal(bytes(e,program.col,1)[0],2);
    pointer(e,'pointerdown',182,54); assert.equal(bytes(e,program.fillMode,1)[0],2);
    pointer(e,'pointermove',154,76); pointer(e,'pointerup',154,76); e.frames(100);
    assert.equal(rawCell(e,2,2),'=A3*B3'); assert.equal(rawCell(e,3,2),'=A4*B4'); assert.equal(rawCell(e,4,2),'=A5*B5');
    assert.equal(value(e,2,2),6); assert.equal(value(e,4,2),10);
    assert.equal(bytes(e,program.fillMode,1)[0],0);
});

test('cancelling a captured pointer aborts native drag fill without changing destination cells', async () => {
    const e=await start();
    setCells(e,{ A1:'=B1*2',A2:'KEEP' });
    pointer(e,'pointerdown',70,46); assert.equal(bytes(e,program.fillMode,1)[0],2);
    pointer(e,'pointermove',42,60);
    e.elements.get('screen').dispatchEvent({type:'pointercancel'}); e.frames(100);
    assert.equal(bytes(e,program.fillMode,1)[0],0); assert.equal(rawCell(e,1,0),'KEEP');
});

test('keyboard fill adjusts references upwards and leftwards and scrolls across viewport pages', async () => {
    const e=await start();
    setCells(e,{ C2:'=B2+$A$1' }); selectCell(e,1,2);
    key(e,'F5'); key(e,'ArrowUp'); key(e,'ArrowLeft'); key(e,'Enter'); e.frames(100);
    assert.equal(rawCell(e,0,1),'=A1+$A$1'); assert.equal(rawCell(e,0,2),'=B1+$A$1');
    assert.equal(rawCell(e,1,1),'=A2+$A$1'); assert.equal(rawCell(e,1,2),'=B2+$A$1');
    setCells(e,{C16:'=A16*B16'});
    pointer(e,'pointerdown',154,164); pointer(e,'pointerup',154,164);
    assert.equal(bytes(e,program.row,1)[0],15);
    key(e,'F5'); key(e,'ArrowDown'); e.frames(100); key(e,'ArrowDown'); key(e,'Enter'); e.frames(100);
    assert.equal(bytes(e,program.top,1)[0],16);
    assert.equal(rawCell(e,16,2),'=A17*B17'); assert.equal(rawCell(e,17,2),'=A18*B18');
});
