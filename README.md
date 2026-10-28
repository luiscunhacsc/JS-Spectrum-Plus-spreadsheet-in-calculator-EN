# JS Spectrum 128K

A browser-based ZX Spectrum 128K emulator. The interface, memory paging,
frame timing, ROM loading, and AY sound are dedicated to the 128K model.

## Start the emulator

Double-click the launcher for your operating system:

- **Windows:** `Launch-Windows.bat`
- **macOS:** make it executable once with `chmod +x Launch-macOS.command`, then double-click it (if blocked, right-click and choose **Open**).
- **Linux:** make it executable once with `chmod +x Launch-Linux.sh`, then double-click it or run `./Launch-Linux.sh`.

Alternatively, open **`index.html`** directly in a modern browser.

After the emulator opens:

1. Select **Start 128K** to start. The card shows **Running**; selecting it
   again restarts the Spectrum 128K.
2. Audio is on by default and starts when you launch a model. Select **Audio
   on** to mute or unmute it. Browsers require a click before playing sound.
3. To play a tape, select **Load tape**, choose a `.tap` file (or drop one onto
   the tape deck), select **Tape Loader** from the Spectrum menu, and press
   Enter. **Sample games** opens the bundled tape library. You can also load
   tapes with `LOAD ""` from BASIC.

The app is a single, self-contained HTML file. The emulator code, the two 128K
ROMs, model image, keyboard map, and sample tapes are embedded in it; no installation,
server, or additional files are needed to run it.

For custom ROMs, select both 16 KB banks (`128-0.rom` and `128-1.rom`, or ZIP
archives containing them). Files are sorted by filename, ROM 0 before ROM 1.
A single 48K ROM is not accepted. The 128K's built-in **48 BASIC** mode remains
available through its own menu and uses the same 128K hardware emulation.
The old 48K ROM and image remain in `developer/` as source assets, but are not
used or embedded by the build.

**Sample games** includes EXOLON, RoboCop, Target: Renegade, Head over Heels,
Cybernoid, and Cybernoid II in the **128K favourites** group. **The NeverEnding
Story (128K)** is a separate music pick. The original sample games are also kept.
Reset before loading a different game, and press Space if its title screen pauses.
The NeverEnding Story continues automatically from its loading picture to the
credits and theme music; press Space on the credits to enter the adventure.

## Calculator / native spreadsheet

[Watch the Calculator video guide](Screenshots%20and%20Video/Calculator%20Guide.mp4)
(5:10, English narration and captions), or read the
[transcript](Screenshots%20and%20Video/Calculator%20Guide%20-%20Transcript.txt).
It demonstrates entry, formulas, copying, editing, navigation, help, and returning
to the Spectrum menu.

[Versão em português de Portugal](Screenshots%20and%20Video/Guia%20da%20Calculadora%20-%20PT-PT.mp4)
(5:45, com narração, legendas e capítulos em português), com
[transcrição](Screenshots%20and%20Video/Guia%20da%20Calculadora%20-%20PT-PT%20-%20Transcricao.txt).

Choose **Calculator** in the built-in 128K menu to run **Spectrum Calc** on the
emulated Z80, inside the Spectrum display. The sheet starts blank, with columns
**A-H** and **64 rows**. Four columns and sixteen rows are visible at once;
cursor navigation scrolls the sheet. The font, selected cell, formula bar,
keyboard editing and arithmetic all run in the native program.

The light grid has visible cell boundaries and cyan headers that follow the
selected row and column. The calculator interface is in English. Use **Edit,
Clear, Copy, Help** or **Exit** in the on-screen toolbar. Click the selected
cell again, or its **FX** bar, to edit; the bar turns yellow and the toolbar
offers **Save** and **Cancel**. Save confirms the cell and moves down, just like
Enter. The controls below the grid jump by four columns or sixteen rows and
show the visible range. Cell contents are inset from the grid lines for
readability; longer values remain available in the formula bar.

Use **arrows** to move, **Enter** to edit and confirm, and **Escape** to cancel
an edit or return to the Spectrum menu. Type numbers, labels or formulas such as
`=A2*B2` and `=SUM(C2:C10)`. Both decimal commas and points are accepted.
The program supports `+ - * /`, parentheses, cell references and rectangular
`SUM`, `AVERAGE`, `MIN`, `MAX` and `COUNT` ranges, with English function names.
**SS+E** (or **F4** on the PC) opens the native formula reference page.
Cells hold up to 31 characters; numbers display up to two decimal places.

Click a cell to select it, then drag the small square at its bottom-right corner
to fill other visible cells. References move with the copy: filling `=A2*B2`
from C2 to C5 produces `=A5*B5`. `$A$1` stays fixed; `$A1` fixes only the column
and `A$1` only the row. For filling across viewport pages, use **SS+F / F5**,
move with the arrows to the opposite corner of the destination rectangle, then
press **Enter**. **Escape** cancels the fill. Existing destination contents are
replaced; formulas that would exceed 31 characters cancel the whole operation.
The **Copy** toolbar button also starts a fill: click the destination corner,
using the page controls if needed, then select **Apply** or **Cancel**.

The app keeps cell contents in memory when returning to the menu and reopening
Calculator during the same browser session. This version does not save sheets
across page reloads or export CSV. There is no external spreadsheet window.

A portable **`developer/native-calc/spectrum-calc.tap`** is also included. Load
it through Tape Loader to run the program independently of the Calculator hook.
See `developer/native-calc/README.md` for Spectrum keyboard shortcuts, limits,
and rebuilding with z88dk.

## Keyboard

- Click the emulator display to focus keyboard input.
- The footer shows **Keyboard connected** when the display has focus. Tab
  moves to the controls, where Enter and Space work normally. In Spectrum Calc,
  Tab moves to the next cell instead.
- **F1** toggles the keyboard map.
- **F2** toggles fullscreen.
- **F3** toggles large view.
- PC **arrow keys** act as Spectrum cursor keys (Caps Shift + 5/6/7/8).
- PC **Ctrl** maps to Caps Shift; PC **Shift** maps to Symbol Shift.

## Project files

- `index.html` — ready-to-run emulator.
- `Launch-Windows.bat`, `Launch-macOS.command`, `Launch-Linux.sh` — open the emulator in the default browser. macOS/Linux may require making the launcher executable once.
- `LICENSE` — license and attribution.
- `developer/` — editable source, build script, and source assets for regenerating `index.html`.
- `developer/native-calc/` — native spreadsheet source, binary, portable TAP and build script.
- `Screenshots and Video/` — optional demonstrations.

To rebuild the app on Windows, run `developer\build_single_html.ps1` in
PowerShell. It writes the updated standalone `index.html`.

Run regression checks with `node --test --test-concurrency=1`. Running test
files in sequence limits memory use. The bundled EXOLON tape is used for
loading, music, keyboard, and screen-transition checks; set `EXOLON_TAP` to test
a different local copy.

The emulator includes AY-3-8912 music and sound effects (tone, noise, and
envelope), mixed with the beeper. TAP loading supports the ROM's standard and
alternate loading entry points, including the 128K Tape Loader.
