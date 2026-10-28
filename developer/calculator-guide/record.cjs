// Record real Z80 Calculator interactions; no cell contents or results are injected.
// Requires Node.js, ffmpeg, and WAV narration made by narrate.ps1.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { createEmulator } = require('../tests/emulator-harness.cjs');
const program = require('../native-calc/program.json');
const locale = process.argv[2] || 'en';
assert.ok(['en', 'pt-PT'].includes(locale), 'Use en or pt-PT as the locale');
const portuguese = locale === 'pt-PT';
const scenes = require(portuguese ? './scenes.pt-PT.json' : './scenes.json');
const root = path.resolve(__dirname, '../..');
const work = path.join(__dirname, '.render', ...(portuguese ? ['pt-PT'] : []));
const output = path.join(root, 'Screenshots and Video');
const fileStem = portuguese ? 'Guia da Calculadora - PT-PT' : 'Calculator Guide';
const sample = portuguese
    ? { item: 'ARTIGO', quantity: 'QTD', price: 'PRECO', first: 'CANETAS', second: 'CADERNOS', price1: '2,50', price2: '4,75', note: 'NOTA' }
    : { item: 'ITEM', quantity: 'QTY', price: 'PRICE', first: 'PENS', second: 'NOTEBOOKS', price1: '2.50', price2: '4.75', note: 'NOTE' };
const fps = 25;
const chapters = [], keyEvents = [];
let frame = 0, emulator, encoder, encoderDone, activeChapter;
const cursor = { x: 128, y: 96, visible: false, down: false, moved: -10 };

function seconds() { return frame / fps; }
function byte(address) { return emulator.evaluate(`readMemory(${address})`); }
function raw(row, col) {
    return emulator.evaluate(`String.fromCharCode(...Array.from({length:32},(_,i)=>readMemory(${program.cells + (row * 8 + col) * 32}+i))).split('\\0')[0]`);
}
function wav(file) {
    const b = fs.readFileSync(file);
    assert.equal(b.toString('ascii', 0, 4), 'RIFF');
    let fmt, data;
    for (let p = 12; p + 8 <= b.length;) {
        const size = b.readUInt32LE(p + 4), type = b.toString('ascii', p, p + 4);
        if (type === 'fmt ') fmt = b.subarray(p + 8, p + 8 + size);
        if (type === 'data') data = b.subarray(p + 8, p + 8 + size);
        p += 8 + size + (size & 1);
    }
    assert.ok(fmt && data && data.length, `Narration is missing: ${file}`);
    assert.equal(fmt.readUInt16LE(0), 1, 'Narration must be PCM');
    assert.equal(fmt.readUInt16LE(2), 1, 'Narration must be mono');
    assert.equal(fmt.readUInt16LE(14), 16, 'Narration must be 16-bit');
    return { data, rate: fmt.readUInt32LE(4), duration: data.length / fmt.readUInt32LE(8) };
}
function capture(showCursor = true) {
    const rgba = emulator.evaluate('renderScreen(); imgData.data');
    const rgb = Buffer.allocUnsafe(256 * 192 * 3);
    for (let p = 0, q = 0; p < rgba.length; p += 4) {
        rgb[q++] = rgba[p]; rgb[q++] = rgba[p + 1]; rgb[q++] = rgba[p + 2];
    }
    function pixel(x, y, color) {
        if (x < 0 || x >= 256 || y < 0 || y >= 192) return;
        const i = (Math.round(y) * 256 + Math.round(x)) * 3;
        rgb[i] = color[0]; rgb[i + 1] = color[1]; rgb[i + 2] = color[2];
    }
    if (showCursor && cursor.visible && (cursor.down || seconds() - cursor.moved < 1.7)) {
        const x = Math.round(cursor.x), y = Math.round(cursor.y);
        if (cursor.down) for (let a = 0; a < 64; a++) {
            pixel(x + Math.round(Math.cos(a / 32 * Math.PI) * 7), y + Math.round(Math.sin(a / 32 * Math.PI) * 7), [255, 145, 95]);
        }
        const arrow = ['#', '##', '#.#', '#..#', '#...#', '#....#', '#.....#', '#......#', '#...#####', '#..#.#', '#.# #.#', '##  #.#', '     #'];
        for (let dy = 0; dy < arrow.length; dy++) for (let dx = 0; dx < arrow[dy].length; dx++) {
            if (arrow[dy][dx] === '#') pixel(x + dx, y + dy, [8, 12, 18]);
            if (arrow[dy][dx] === '.') pixel(x + dx, y + dy, [255, 255, 255]);
        }
    }
    return rgb;
}
async function push(rgb) {
    if (!encoder.stdin.write(rgb)) await once(encoder.stdin, 'drain');
    frame++;
}
async function advance(n) {
    for (let i = 0; i < n; i++) { emulator.frames(2); await push(capture()); }
}
async function hold(duration) {
    // The screen has no animation while idle; hold actual captured pixels.
    const n = Math.max(0, Math.round(duration * fps));
    const settling = Math.min(n, 10);
    await advance(settling);
    let shown = capture(), hidden;
    for (let i = settling; i < n; i++) {
        if (seconds() - cursor.moved >= 1.7) { hidden ??= capture(false); await push(hidden); }
        else await push(shown);
    }
}
function keyLabel(label, duration = 1.15) {
    if (portuguese) {
        const translated = {
            Down: 'Baixo', Up: 'Cima', Left: 'Esquerda', Right: 'Direita', CLICK: 'CLICAR',
            'DRAG FILL HANDLE': 'ARRASTAR O CANTO', 'FX: EDIT': 'FX: EDITAR',
            'CANCELAR: CANCEL': 'CANCELAR', 'GUARDAR: CONFIRM': 'GUARDAR: CONFIRMAR',
            'LIMPAR: CLEAR': 'LIMPAR', 'NEXT COLUMNS': 'COLUNAS SEGUINTES',
            'ABAIXO: DOWN 16': 'ABAIXO: 16 LINHAS', 'ACIMA: UP 16': 'ACIMA: 16 LINHAS',
            'PREVIOUS COLUMNS': 'COLUNAS ANTERIORES', 'RETURN TO SHEET': 'VOLTAR À FOLHA', 'SAIR: EXIT': 'SAIR'
        };
        label = translated[label] || label.replace(/^TYPE /, 'ESCREVER ').replace(/^SELECT /, 'SELECIONAR ');
    }
    const previous = keyEvents.at(-1);
    if (previous && previous.end > seconds()) previous.end = seconds();
    keyEvents.push({ start: seconds(), end: seconds() + duration, label });
}
function dispatch(code, pressed, key) {
    if (key === undefined) emulator.dispatchKey(code, pressed ? 'keydown' : 'keyup');
    else emulator.evaluate(`window.dispatchEvent({type:${JSON.stringify(pressed ? 'keydown' : 'keyup')},key:${JSON.stringify(key)},code:${JSON.stringify(code)},preventDefault(){}});`);
}
async function press(code, label = code.replace('Arrow', '')) {
    keyLabel(label); cursor.visible = false;
    dispatch(code, true); await advance(8); dispatch(code, false); await advance(code === 'Enter' ? 40 : 24);
}
async function type(text) {
    keyLabel(`TYPE ${text}`, text.length * 0.48 + 0.2); cursor.visible = false;
    for (const ch of text) {
        const code = /[a-z]/i.test(ch) ? 'Key' + ch.toUpperCase() : /\d/.test(ch) ? 'Digit' + ch : 'Text' + ch;
        dispatch(code, true, ch); await advance(6); dispatch(code, false, ch); await advance(6);
    }
}
async function enter(text) { await type(text); await press('Enter'); }
function pointer(type) {
    emulator.elements.get('screen').dispatchEvent({ type, button: 0, pointerId: 1, clientX: cursor.x * 2, clientY: cursor.y * 2 });
}
async function movePointer(x, y, n = 12) {
    const sx = cursor.x, sy = cursor.y;
    cursor.visible = true;
    for (let i = 1; i <= n; i++) {
        const t = i / n, ease = t * t * (3 - 2 * t);
        cursor.x = sx + (x - sx) * ease; cursor.y = sy + (y - sy) * ease; cursor.moved = seconds();
        pointer('pointermove'); await advance(1);
    }
}
async function click(x, y, label = 'CLICK') {
    await movePointer(x, y); keyLabel(label);
    cursor.down = true; pointer('pointerdown'); await advance(8);
    cursor.down = false; pointer('pointerup'); await advance(24);
}
async function select(row, col) {
    if (byte(program.row) === row && byte(program.col) === col) return;
    const top = byte(program.top), left = byte(program.left);
    assert.ok(row >= top && row < top + 16 && col >= left && col < left + 4, 'Selection must be visible');
    await click(16 + (col - left) * 56 + 26, (5 + row - top) * 8 + 4, `SELECT ${String.fromCharCode(65 + col)}${row + 1}`);
}
async function put(row, col, text) { await select(row, col); await enter(text); assert.equal(raw(row, col), text); }
async function scene(index, action) {
    const info = scenes[index], start = seconds();
    const clips = info.speech.map((text, n) => ({ text, ...wav(path.join(work, 'audio', `${String(index + 1).padStart(2, '0')}-${String(n + 1).padStart(2, '0')}.wav`)) }));
    activeChapter = { start, clips };
    const voiceDuration = clips.reduce((sum, clip) => sum + clip.duration + 0.22, 0);
    await hold(0.7); await action();
    const duration = Math.max(info.minimum, voiceDuration + 1, seconds() - start + 2.5);
    await hold(duration - (seconds() - start));
    const end = seconds();
    if (keyEvents.at(-1)?.end > end) keyEvents.at(-1).end = end;
    chapters.push({ ...info, clips, start, end });
    console.log(`Captured ${index + 1}/${scenes.length}: ${info.title} (${(end - start).toFixed(1)}s)`);
}
async function cue(sentence, offset = 0) {
    const at = activeChapter.start + 0.45 + activeChapter.clips.slice(0, sentence).reduce((sum, clip) => sum + clip.duration + 0.22, 0) + offset;
    await hold(Math.max(0, at - seconds()));
}
function assTime(t) {
    const c = Math.round(t * 100); return `${Math.floor(c / 360000)}:${String(Math.floor(c / 6000) % 60).padStart(2, '0')}:${String(Math.floor(c / 100) % 60).padStart(2, '0')}.${String(c % 100).padStart(2, '0')}`;
}
function srtTime(t) {
    const ms = Math.round(t * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
function wrap(text, width) {
    const result = []; let line = '';
    for (const word of text.split(/\s+/)) {
        if (line && line.length + word.length + 1 > width) { result.push(line); line = ''; }
        line += (line ? ' ' : '') + word;
    }
    if (line) result.push(line); return result.join('\n');
}
function makeAssets() {
    const duration = seconds(), rate = chapters[0].clips[0].rate;
    const pcm = Buffer.alloc(Math.ceil(duration * rate) * 2);
    const subtitleEvents = [], srt = [];
    const ass = ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1280', 'PlayResY: 720', 'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '', '[V4+ Styles]', 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        'Style: Brand,Segoe UI,18,&H00EAF0F6,&H00EAF0F6,&H001E1610,&H001E1610,-1,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1',
        'Style: Kicker,Segoe UI,16,&H00C0DC68,&H00C0DC68,&H001E1610,&H001E1610,-1,0,0,0,100,100,1,0,1,0,0,7,0,0,0,1',
        'Style: Title,Segoe UI,32,&H00F6F3EF,&H00F6F3EF,&H001E1610,&H001E1610,-1,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1',
        'Style: Body,Segoe UI,23,&H00D8CCC2,&H00D8CCC2,&H001E1610,&H001E1610,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1',
        'Style: Code,Consolas,25,&H00C0DC68,&H00C0DC68,&H001E1610,&H001E1610,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1',
        'Style: Tip,Segoe UI,17,&H00A69686,&H00A69686,&H001E1610,&H001E1610,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1',
        'Style: Caption,Segoe UI,20,&H00FFFFFF,&H00FFFFFF,&H001E1610,&H001E1610,0,0,0,0,100,100,0,0,1,2,0,2,0,0,0,1',
        'Style: Keys,Consolas,17,&H001E1610,&H001E1610,&H00C0DC68,&H00C0DC68,-1,0,0,0,100,100,0,0,3,5,0,7,0,0,0,1',
        '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'];
    const clean = text => text.replace(/\\/g, '/').replace(/[{}]/g, '').replace(/\n/g, '\\N');
    function line(style, start, end, x, y, text, align = 7) {
        ass.push(`Dialogue: ${style === 'Keys' ? 5 : 1},${assTime(start)},${assTime(end)},${style},,0,0,0,,{\\an${align}\\pos(${x},${y})}${clean(text)}`);
    }
    line('Brand', 0, duration, 96, 22, portuguese ? 'SPECTRUM CALC  /  GUIA DE UTILIZAÇÃO' : 'SPECTRUM CALC  /  HOW TO USE IT');
    chapters.forEach((ch, i) => {
        line('Kicker', ch.start, ch.end, 48, 91, `${portuguese ? 'PASSO' : 'STEP'} ${String(i + 1).padStart(2, '0')}`);
        line('Title', ch.start, ch.end, 48, 126, wrap(ch.title, 20));
        line('Body', ch.start, ch.end, 48, 238, ch.body);
        line('Code', ch.start, ch.end, 48, 477, ch.code);
        line('Tip', ch.start, ch.end, 48, 583, ch.tip);
        line('Tip', ch.start, ch.end, 1224, 25, `${String(i + 1).padStart(2, '0')} / ${scenes.length}`, 9);
        let at = ch.start + 0.45;
        for (const clip of ch.clips) {
            assert.equal(clip.rate, rate);
            clip.data.copy(pcm, Math.round(at * rate) * 2);
            const chunks = [], words = clip.text.split(/\s+/); let group = [];
            for (const word of words) {
                if (group.length && group.join(' ').length + word.length + 1 > 106) { chunks.push(group); group = []; }
                group.push(word);
            }
            if (group.length) chunks.push(group);
            let captionAt = at;
            for (const group of chunks) {
                const end = captionAt + clip.duration * group.length / words.length;
                const text = wrap(group.join(' '), 56);
                line('Caption', captionAt, end, 640, 711, text, 2);
                subtitleEvents.push({ start: captionAt, end, text }); captionAt = end;
            }
            at += clip.duration + 0.22;
        }
    });
    for (const ev of keyEvents) if (ev.end - ev.start >= 0.1) line('Keys', ev.start, ev.end, 53, 550, ev.label);
    for (let i = 0; i < subtitleEvents.length; i++) {
        const s = subtitleEvents[i]; srt.push(`${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`);
    }
    const header = Buffer.alloc(44);
    header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28);
    header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
    fs.writeFileSync(path.join(work, 'narration.wav'), Buffer.concat([header, pcm]));
    fs.writeFileSync(path.join(work, 'guide.ass'), ass.join('\n'));
    fs.writeFileSync(path.join(output, `${fileStem}.srt`), srt.join('\n'));
    const transcriptHeader = portuguese
        ? 'SPECTRUM CALC - GUIA DE UTILIZAÇÃO\nNarração e legendas em português de Portugal; voz Microsoft Hélia (pt-PT).\nGravado a partir da Calculadora Z80 real.\n\n'
        : 'SPECTRUM CALC - HOW TO USE IT\nEnglish narration; recorded from the actual Z80 Calculator.\n\n';
    fs.writeFileSync(path.join(output, `${fileStem}${portuguese ? ' - Transcricao' : ' - Transcript'}.txt`), transcriptHeader + chapters.map(ch => `${srtTime(ch.start).slice(0, 8)}  ${ch.title}\n${ch.speech.join(' ')}\n`).join('\n'));
    const metadataHeader = portuguese
        ? ';FFMETADATA1\ntitle=Spectrum Calc - Guia da Calculadora (Portugal)\ncomment=Narração e legendas em português de Portugal (pt-PT). Voz Microsoft Hélia.\n'
        : ';FFMETADATA1\ntitle=Spectrum Calc - How to use the Calculator\ncomment=English narration and captions. Actual emulator interactions.\n';
    fs.writeFileSync(path.join(work, 'chapters.ffmeta'), metadataHeader + chapters.map(ch => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(ch.start * 1000)}\nEND=${Math.round(ch.end * 1000)}\ntitle=${ch.title}\n`).join(''));
    const filter = "[0:v]scale=768:576:flags=neighbor,pad=1280:720:456:72:color=0x10161e,drawbox=x=448:y=64:w=784:h=592:color=0x556779:t=2,drawbox=x=48:y=64:w=1184:h=1:color=0x293848:t=fill,drawbox=x=48:y=21:w=7:h=22:color=0xf16365:t=fill,drawbox=x=57:y=21:w=7:h=22:color=0xf2d764:t=fill,drawbox=x=66:y=21:w=7:h=22:color=0x77cb91:t=fill,drawbox=x=75:y=21:w=7:h=22:color=0x6dc9e5:t=fill,ass=guide.ass[v]";
    fs.writeFileSync(path.join(work, 'layout.ffscript'), filter);
    fs.writeFileSync(path.join(work, 'timing.json'), JSON.stringify({ duration, chapters: chapters.map(({ title, start, end }) => ({ title, start, end })) }, null, 2));
}

async function main() {
    fs.mkdirSync(work, { recursive: true }); fs.mkdirSync(output, { recursive: true });
    emulator = createEmulator(); await emulator.evaluate('loadBuiltIn128K()'); emulator.frames(200);
    const encodeLog = fs.openSync(path.join(work, 'capture.log'), 'w');
    encoder = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-y', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', '256x192', '-framerate', String(fps), '-i', 'pipe:0', '-an', '-c:v', 'ffv1', '-level', '3', path.join(work, 'screen.mkv')], { stdio: ['pipe', 'ignore', encodeLog], windowsHide: true });
    encoderDone = once(encoder, 'close');
    encoder.stdin.on('error', () => {});
    await scene(0, async () => { await cue(1); await press('ArrowDown'); await hold(0.7); await press('ArrowDown'); await hold(1); await press('Enter'); await advance(35); assert.equal(byte(program.ready), 1); });
    await scene(1, async () => { await select(2, 2); await hold(2); await press('ArrowLeft'); await hold(1); await press('Tab'); await hold(1); await select(0, 0); });
    await scene(2, async () => { await put(0, 0, sample.item); await put(0, 1, sample.quantity); await put(0, 2, sample.price); await put(0, 3, 'TOTAL'); });
    await scene(3, async () => { await put(1, 0, sample.first); await put(1, 1, '3'); await put(1, 2, sample.price1); await cue(1); await put(2, 0, sample.second); await put(2, 1, '2'); await put(2, 2, sample.price2); });
    await scene(4, async () => { await put(1, 3, '=B2*C2'); await select(1, 3); });
    await scene(5, async () => {
        await select(1, 3); await movePointer(238, 54); await hold(1);
        keyLabel('DRAG FILL HANDLE', 3); cursor.down = true; pointer('pointerdown'); await advance(10);
        assert.equal(byte(program.fillMode), 2); await movePointer(210, 60, 40); await hold(0.6);
        cursor.down = false; pointer('pointerup'); await advance(24); assert.equal(raw(2, 3), '=B3*C3'); await select(2, 3);
    });
    await scene(6, async () => { await put(3, 2, 'TOTAL'); await put(3, 3, '=SUM(D2:D3)'); await select(3, 3); });
    await scene(7, async () => {
        await select(1, 1); await click(120, 12, 'FX: EDIT'); await press('Backspace'); await type('9'); await cue(1, 3); await click(64, 28, 'CANCEL'); assert.equal(raw(1, 1), '3');
        await cue(2); await press('Enter'); await press('Backspace'); await type('4'); await click(20, 28, 'SAVE: CONFIRM'); assert.equal(raw(1, 1), '4'); await select(3, 3);
    });
    await scene(8, async () => { await put(5, 0, sample.note); await select(5, 0); await hold(1); await click(64, 28, 'CLEAR'); assert.equal(raw(5, 0), ''); });
    await scene(9, async () => {
        await cue(1);
        await click(36, 172, 'NEXT COLUMNS'); await hold(2); assert.equal(byte(program.left), 4);
        await click(215, 172, 'DOWN 16 ROWS'); await hold(2); assert.equal(byte(program.top), 16);
        await click(150, 172, 'UP 16 ROWS'); await hold(1); await click(4, 172, 'PREVIOUS COLUMNS'); await select(3, 3);
    });
    await scene(10, async () => {
        await select(1, 3); await press('F5'); await hold(1); await press('ArrowDown'); await cue(1); await press('Escape'); assert.equal(byte(program.fillMode), 0);
        await press('ArrowUp'); await press('F5'); await press('ArrowDown'); await hold(1); await press('Enter'); assert.equal(raw(2, 3), '=B3*C3');
    });
    await scene(11, async () => { await press('F4'); await cue(1, 2); await click(80, 188, 'RETURN TO SHEET'); assert.equal(byte(program.helpActive), 0); });
    await scene(12, async () => {
        await click(225, 28, 'EXIT'); await advance(25); assert.equal(emulator.evaluate('nativeCalcContext'), null); await hold(2);
        await press('ArrowDown'); await press('ArrowDown'); await press('Enter'); await advance(40); await select(3, 3); assert.equal(raw(3, 3), '=SUM(D2:D3)'); assert.equal(raw(1, 1), '4');
    });
    encoder.stdin.end(); const [code] = await encoderDone; fs.closeSync(encodeLog); assert.equal(code, 0, 'Screen encoding failed');
    makeAssets();
    console.log(`Compositing ${seconds().toFixed(1)} seconds of 720p video with narration, captions and chapters...`);
    const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-y', '-i', 'screen.mkv', '-i', 'narration.wav', '-f', 'ffmetadata', '-i', 'chapters.ffmeta', '-filter_complex_script', 'layout.ffscript', '-map', '[v]', '-map', '1:a:0', '-map_metadata', '2', '-map_chapters', '2', '-metadata:s:a:0', `language=${portuguese ? 'por' : 'eng'}`, '-metadata:s:a:0', `title=${portuguese ? 'Português (Portugal)' : 'English'}`, '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', String(fps), '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-t', seconds().toFixed(2), path.join(output, `${fileStem}.mp4`)], { cwd: work, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', windowsHide: true });
    fs.writeFileSync(path.join(work, 'render.log'), result.stderr || ''); assert.equal(result.status, 0, result.stderr);
    console.log(`Created ${path.join(output, `${fileStem}.mp4`)}`);
}
main().catch(error => { console.error(error); encoder?.kill(); process.exitCode = 1; });
