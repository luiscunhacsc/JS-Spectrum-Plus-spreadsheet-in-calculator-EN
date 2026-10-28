# Calculator video guide

The finished video is [Calculator Guide.mp4](../../Screenshots%20and%20Video/Calculator%20Guide.mp4):
5 minutes 10 seconds, 1280 x 720, with English narration, captions, highlighted
mouse/keyboard actions, and 13 seekable chapters. Its `.srt` captions and
transcript are alongside the video.

A [Portuguese (Portugal) version](../../Screenshots%20and%20Video/Guia%20da%20Calculadora%20-%20PT-PT.mp4)
is also available: 5 minutes 45 seconds, with Portuguese narration, captions,
instructions and chapters. The example uses ARTIGO, QTD, PRECO, CANETAS and
CADERNOS, and enters decimal commas. Its `.srt`, transcript and preview are
saved separately beside the English version.

The recording executes the production HTML and native Z80 Calculator through
the emulator harness. It enters every label, value, and formula through the
real keyboard/mouse handlers and checks the resulting cell contents. No sheet
data or calculated results are injected. The shopping-list example reaches
17, then recalculates to 19.5 after changing a quantity.

To regenerate on Windows, install Node.js and FFmpeg, rebuild `index.html` if
the app has changed, and run from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File developer/calculator-guide/narrate.ps1
node developer/calculator-guide/record.cjs
```

For the Portuguese version:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File developer/calculator-guide/narrate.ps1 -Locale pt-PT
node developer/calculator-guide/record.cjs pt-PT
```

Narration uses the installed Microsoft Zira voice, falling back to the default
Windows SAPI voice. `scenes.json` contains the instructions and narration.
The Portuguese version uses the installed Microsoft Hélia OneCore voice with
locale **pt-PT (0816)**, accessed directly without registry changes. It requires
that voice and never falls back to an English or Brazilian Portuguese voice.
Its script is `scenes.pt-PT.json`; its intermediate assets go in `.render/pt-PT/`.
Intermediate recordings and audio are kept in `.render/`; the final video,
captions, and transcript are written to `Screenshots and Video/`.

Validation: every demonstrated cell entry/copy/cancellation is checked during
recording; the finished MP4 was decoded end to end, checked for audible audio
without clipping, and visually reviewed at the total, editing, and help steps.
