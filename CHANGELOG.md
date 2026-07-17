# Changelog

## [Unreleased]

### Fixed
- **RTL/LTR text overflow in overlay transcript**: Mixed bidirectional content
  (e.g., `cpp_str المعكوس`) would exceed the overlay frame boundaries because
  the previous wrapping logic didn't account for Unicode UAX #9 bidi rules.
  - `wrapTranscript()` now uses `bidiWrapText()` for lines containing RTL
    characters, with a fast path for pure LTR content
  - `fitRenderedLine()` uses `bidiVisibleWidth()` and `bidiTruncate()` for
    accurate width measurement and bidi-safe truncation
  - Code identifiers (e.g., `cpp_str`, `getUserName`) are now preserved with
    proper directional isolation (FSI/PDI) instead of being visually reversed
  - Added 25 visual regression tests covering pure Arabic, pure English, mixed
    RTL/LTR, code identifiers, multi-paragraph content, and edge cases

### Added
- **`lib/bidi-wrap.ts`**: A new 480-line bidi-aware text processing module
  - `wrapWithIsolates(text)` — wraps each RTL/LTR run with U+2068/U+2069
  - `splitRuns(text)` — classifies text into directional runs
  - `bidiWrapText(text, width)` — width-aware wrapping preserving ANSI
  - `bidiTruncate(text, width, ellipsis?)` — width-aware truncation
  - `bidiVisibleWidth(text)` — display width ignoring markers/ANSI
  - `isRtlChar(ch)` / `isBidiContent(text)` — classification helpers
  - `detectDirection(text)` / `normalizeBidi(text)` — utility helpers
- **`tests/bidi-wrap.test.ts`**: 25 visual regression tests for the bidi
  behavior in the overlay (pure Arabic, mixed RTL/LTR, code identifiers,
  edge cases)

### Technical
- Added `containsBidi()` helper to `BtwOverlayComponent` for fast
  detection of RTL content
- Performance: pure-LTR lines use the existing `wrapTextWithAnsi()` path
  to avoid unnecessary bidi marker overhead
- All existing 56 tests still pass; total now 81 tests passing