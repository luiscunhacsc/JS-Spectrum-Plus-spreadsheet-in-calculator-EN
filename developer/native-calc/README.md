# Spectrum Calc

A native Z80 spreadsheet. The processor executes the C parser, floating-point
arithmetic, dependency recalculation, keyboard polling and screen drawing.
`screen.asm` writes the Spectrum bitmap and attribute memory using an original
3x5 font in 4x8 character cells. There is no HTML spreadsheet or JavaScript
formula engine.

The sheet starts blank: **8 columns (A–H), 64 rows**, with **31 characters per
cell**. Four columns and sixteen rows are visible at a time. Cursor navigation
scrolls the viewport. Numbers show up to two decimal places; calculations retain
the runtime's floating-point precision. Numeric results are limited to
±999,999,999, and dependency chains to 24 cells to protect the Z80 stack.
Displayed cell values have a one-character inset from the grid lines; longer
entries can be read in the formula bar.

Supported formulas: `+ - * /`, parentheses, references such as `A1` or `$A$1`,
and one rectangular range per `SUM`, `AVERAGE`, `MIN`, `MAX` or `COUNT` call,
e.g. `=SUM(C2:C10)`. Function names are in English and case-insensitive.
Decimals accept either `.` or `,`. A formula starts with `=`. Other entries are
numbers or text. Aggregates ignore text and blanks; `COUNT` counts numeric cells.
`AVERAGE` of an empty range reports `#DIV/0!`; an empty `SUM`, `MIN`, `MAX` or
`COUNT` returns zero. Arithmetic on text reports `#VALUE!`.
Invalid formulas, references, zero division, circular references and oversized
results produce visible errors. Editing any cell recalculates dependencies.

## Controls

On the emulated PC keyboard:

- **Arrows:** move; **Tab / Shift+Tab:** move right / left.
- **Enter:** edit the current cell; Enter again commits and moves down.
- Start typing to replace the selected cell.
- **Backspace / Delete:** erase a character while editing, or clear a cell.
- **Escape:** cancel an edit; outside editing, return to the Spectrum menu.
- **F4:** native formula reference; Enter returns to the sheet.
- **F5:** begin fill; use arrows to choose the end cell and Enter to apply.
- **Mouse:** click to select; drag the small bottom-right cell square to fill.
- Click the selected cell again, or the **FX** bar, to edit it. The yellow bar
  shows the pending entry; **Save / Cancel** commit or discard it.
- The native toolbar provides **Edit / Clear / Copy / Help / Exit**.
  **Copy** accepts a destination click, then **Apply / Cancel**. It warns
  that destination contents will be replaced. The controls below the grid jump
  four columns or sixteen rows and show the visible column and row ranges.
- Help closes with its bottom button, **Enter**, or **Escape**. Clicking a
  different cell while editing commits the entry and selects that cell.
- Type punctuation using the PC keyboard, including `=`, `*`, `:` and `,`.

On Spectrum hardware / the portable TAP:

- **Caps Shift + 5/6/7/8:** left/down/up/right.
- **Caps Shift + 0:** delete; **Caps Shift + Space:** cancel / exit.
- **Symbol Shift + E:** formula reference; **Symbol Shift + Q:** exit.
- **Symbol Shift + F:** begin fill; cursors extend the rectangle; Enter applies.
- Symbols follow the Spectrum keys: **SS+L** `=`, **SS+B** `*`, **SS+Z** `:`.

Example: put `3` in A2 and `2,50` in B2, then `=A2*B2` in C2. Add more rows,
then enter `=SUM(C2:C10)` in C11. The sum cell must be outside its own range.

## Copy and fill

Select a populated cell. Drag its small corner square across the visible grid,
or use **SS+F / F5**, navigate to the opposite corner of the destination
rectangle and press Enter. Keyboard fill scrolls across viewport pages.
**Caps Shift + Space / Escape** cancels. Releasing the mouse fills the previewed
rectangle; a cancelled pointer gesture leaves destination cells unchanged.

The original cell supplies the formula for every destination. Relative row and
column references shift by the distance from that original cell, including both
ends of range references. `$A$1` fixes both dimensions; `$A1` fixes the column;
`A$1` fixes the row. For example, copying `=A2*B2` from C2 to C5 yields
`=A5*B5`. Text and literal values repeat unchanged. This is formula/value fill,
not automatic numeric series generation.

Fill replaces destination contents. A reference shifted outside A1:H64 becomes
`#REF!`. The entire operation is checked before writing: if any translated
formula would exceed the 31-character cell limit, no destination is changed.
Translation, validation, filling and recalculation all execute on the Z80.

## Build and run

The checked-in `.bin`, `.tap` and `program.json` are ready to use. Load
`spectrum-calc.tap` through Tape Loader or `LOAD ""`. It includes its own BASIC
loader and runs without the application's Calculator hook.

Recompile using [z88dk](https://github.com/z88dk/z88dk):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File developer/native-calc/build.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File developer/build_single_html.ps1
node --test --test-concurrency=1
```

`build.ps1` accepts `-Compiler` for an explicit `zcc` path. It compiles at 24000
and checks that the linked image leaves stack space below 65280. `program.json`
contains that image and linker-derived addresses; the standalone HTML embeds it.
`fill.c` contains the reference translator, rectangle fill and Kempston mouse
handling. The small direct-mapped numeric cache preserves the grid dimensions
and floating-point precision while leaving native stack space for these tools.
The origin leaves room for the portable BASIC loader and keeps the expanded UI
within the same stack-space limit. The light grid, selected headers, formula
bar, toolbar, help and page controls are all drawn directly into Spectrum RAM.

In the app, the known Calculator ROM entry launches the image. The integration
preserves the Spectrum RAM and CPU context, then restores the native menu on
exit. Cell bytes are retained in memory for reopening during the current browser
session. They are not saved across page reloads. This version has no CSV export
or persistent file saving. JavaScript only loads/preserves bytes and translates
PC keys to Spectrum matrix chords and pointer movements to Kempston mouse
counters; it performs no spreadsheet calculations or reference translation.

An optional `OUT (0x00EF),0xA5` exit notification lets the app restore the menu.
On a standalone machine this output is ignored and the normal C runtime returns
to BASIC. The linked runtime comes from z88dk; its accompanying licence is in
`Z88DK-LICENSE`.
