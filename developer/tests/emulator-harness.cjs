const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createEmulator(htmlPath = path.join(__dirname, '../../index.html'), { audio = false, storage } = {}) {
    const elements = new Map();
    let createdElements = 0;
    function eventTarget() {
        const listeners = new Map();
        return {
            addEventListener(type, fn) {
                if (!listeners.has(type)) listeners.set(type, []);
                listeners.get(type).push(fn);
            },
            dispatchEvent(event) {
                event.target ??= this;
                event.preventDefault ??= () => { event.defaultPrevented = true; };
                for (const fn of listeners.get(event.type) || []) fn(event);
            }
        };
    }
    const document = eventTarget();
    function element(id) {
        if (!elements.has(id)) {
            const classes = new Set();
            const el = {
                ...eventTarget(),
                children: [],
                appendChild(child) { this.children.push(child); return child; },
                get innerHTML() { return this.html || ''; },
                set innerHTML(value) { this.html = value; this.children.length = 0; },
                style: {}, dataset: {}, lastChild: {}, parentElement: { dataset: {} }, clientWidth: 800,
                classList: {
                    add: (name) => classes.add(name), remove: (name) => classes.delete(name),
                    contains: (name) => classes.has(name),
                    toggle(name, value) { if (value) classes.add(name); else classes.delete(name); }
                },
                setAttribute() {},
                getBoundingClientRect: () => ({ left:0, top:0, width:512, height:384 }),
                setPointerCapture() {},
                hasPointerCapture: () => false,
                releasePointerCapture() {},
                select() {},
                blur() {
                    if (document.activeElement !== el) return;
                    document.activeElement = null;
                    el.dispatchEvent({ type: 'blur' });
                },
                focus() {
                    if (document.activeElement === el) return;
                    document.activeElement?.dispatchEvent({ type: 'blur' });
                    document.activeElement = el;
                    el.dispatchEvent({ type: 'focus' });
                },
                querySelector: (selector) => element(id + selector),
                getContext: () => ({
                    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
                    putImageData() {}
                })
            };
            elements.set(id, el);
        }
        return elements.get(id);
    }
    document.getElementById = element;
    document.querySelector = element;
    document.createElement = (tag) => Object.assign(element(`created-${++createdElements}`), { tagName: tag.toUpperCase() });
    document.body = element('body');
    const sandbox = {
        ...eventTarget(),
        document, console, module: {}, Uint8Array, Uint8ClampedArray, Uint32Array, DataView,
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
        getComputedStyle: () => ({ paddingLeft: '0', paddingRight: '0' }),
        innerHeight: 900
    };
    sandbox.window = sandbox;
    if (storage) sandbox.localStorage = storage;
    if (audio) {
        sandbox.AudioContext = class {
            constructor() { this.currentTime = 0; this.state = 'running'; this.starts = []; }
            createGain() {
                const gain = { value: 1, setTargetAtTime(value) { this.value = value; } };
                return { gain, connect() {} };
            }
            createBuffer(channels, size, rate) {
                const samples = new Float32Array(size);
                return { duration: size / rate, getChannelData: () => samples };
            }
            createBufferSource() {
                const context = this;
                return { connect() {}, start(time) { context.starts.push(time); context.lastBuffer = this.buffer; } };
            }
            async resume() { this.state = 'running'; }
        };
    }
    const context = vm.createContext(sandbox);
    const evaluate = (code) => vm.runInContext(code, context);
    const html = fs.readFileSync(htmlPath, 'utf8');
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
        const src = /src="([^"]+)"/.exec(match[1]);
        evaluate(src ? fs.readFileSync(path.resolve(path.dirname(htmlPath), src[1]), 'utf8') : match[2]);
    }
    function frames(count) {
        evaluate(`for (let frame = 0; frame < ${count}; frame++) {
            if (audioCtx) audioCtx.currentTime += 0.02;
            loop();
        }`);
    }
    function chord(codes, count = 5) {
        for (const code of codes) dispatchKey(code, 'keydown');
        frames(count);
        for (const code of [...codes].reverse()) dispatchKey(code, 'keyup');
        frames(5);
    }
    function dispatchKey(code, type) {
        const key = code.startsWith('Key') ? code.slice(3).toLowerCase()
            : code.startsWith('Digit') ? code.slice(5)
            : code.startsWith('Shift') ? 'Shift' : code.startsWith('Control') ? 'Control'
            : code === 'Space' ? ' ' : code;
        sandbox.dispatchEvent({ type, code, key, ctrlKey: false, shiftKey: false });
    }
    function click(id) {
        const target = element(id);
        target.focus();
        target.dispatchEvent({ type: 'click', stopPropagation() {} });
    }
    function key(code, count = 5) { chord([code], count); }
    function setTape(bytes, name = 'test.tap') {
        sandbox.testTape = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        evaluate(`setTapeBuffer(testTape, ${JSON.stringify(name)})`);
    }
    function insertTape(file) {
        setTape(fs.readFileSync(file), path.basename(file));
    }
    return { evaluate, frames, key, chord, dispatchKey, click, setTape, insertTape, elements };
}

module.exports = { createEmulator };
