# Sample tapes

The standalone build embeds every `.tap` in this directory. Friendly names and
sample-menu groups are defined by `DEFAULT_SAMPLE_TAPS` in `../js_spectrum.html`.

The following additions were imported on 2026-10-27. ZIP archives were opened
and the TAP bytes were extracted unchanged, except for the loader adjustment
described below. EXOLON is the exact tape supplied by the user.

| Sample | Source |
| --- | --- |
| EXOLON | User-supplied `EXOLON.TAP` |
| Head over Heels | [World of Spectrum Classic](https://worldofspectrum.net/pub/sinclair/games/h/HeadOverHeels.tap.zip) |
| RoboCop | [World of Spectrum Classic](https://worldofspectrum.net/pub/sinclair/games/r/RoboCop.tap.zip) |
| Target: Renegade | [World of Spectrum Classic, 128K edition](https://worldofspectrum.net/pub/sinclair/games/t/Target-Renegade128.tap.zip) |
| Cybernoid | [World of Spectrum Classic, 128K edition](https://worldofspectrum.net/pub/sinclair/games/c/Cybernoid128.tap.zip) |
| Cybernoid II: The Revenge | [World of Spectrum Classic, 128K edition](https://worldofspectrum.net/pub/sinclair/games/c/CybernoidII-TheRevenge128.tap.zip) |
| The NeverEnding Story | [World of Spectrum Classic, 128K edition](https://worldofspectrum.net/pub/sinclair/games/n/NeverEndingStoryThe128.tap.zip) |

Game copyrights belong to their respective owners. The emulator's MIT license
does not relicense the bundled games.

The NeverEnding Story's BASIC loader, line 35, uses `PAUSE 1` instead of
`PAUSE 0` so the loading picture continues into the credits and theme music
automatically. Only the ASCII digit and its encoded numeric value were changed;
the block checksum was recalculated. The game and music payloads are unchanged.
The original extracted TAP's SHA-256 was
`0f4c305d904635c13c8057aaeeb926769cb1e47d068f568d8060b18de565da29`.

SHA-256 checksums of the extracted TAP files:

```text
31537fa52ce1e197c129a80d4e4e1efefceff58726471a0d5a571add45ab5f77  Exolon (1987)(Hewson)(48K-128K).tap
462ba6d357fe9cebc213aa52dce8f31844f01ef9623a13ea698a0041b436891d  Head over Heels (1987)(Ocean)(48K-128K).tap
c21fea6b08e630dd25e86461f9e41c715bd38ca75b06ddf21679bd4fd69fc517  RoboCop (1988)(Ocean)(48K-128K).tap
073f021238c0588bcce715e569db35675e49e4e7ba289b844196e9ff6767d0ca  Target Renegade (1988)(Imagine)(128K).tap
379db1707f134e40ad53b17a59a24e87e38fdfce4416a51d267bff04f6db28a2  Cybernoid (1988)(Hewson)(128K).tap
bf416648617f2ec3fbc9de99db38c679d9777a9eb993864d53f2b1bc92a2de92  Cybernoid II (1988)(Hewson)(128K).tap
697c2a6fa0847f8097c28c767b63e6659150d850bc4b23ece105b919e6d15ef5  The NeverEnding Story (1985)(Ocean)(128K).tap
```
