# Changelog

All notable changes to this project are documented here.

## [0.5.0] - 2026-09-15

Requires Pi 0.85.1 or newer.

### Added
- **Full-width overlay toggle**: `Alt+w` switches the BTW overlay between the
  framed "window" layout and an edge-to-edge full-width layout. Full-width mode
  drops the side borders and corner glyphs so a terminal Shift+drag selection
  captures only the dialog's own text — handy for copying without pulling in
  surrounding main-screen content. The width preference is in-memory for the
  session. (@dbachelder, building on the report and prototype from @kunrenzhilu in #39)
- **Abort-first Escape while streaming**: the first `Esc` during a streaming
  response aborts the request and keeps its partial transcript visible; a
  second `Esc` dismisses the overlay. (@kunrenzhilu, #38)
- **Configurable focus shortcuts**: set `PI_BTW_FOCUS_KEYS` to remap the
  BTW focus-toggle keys when the defaults conflict with your window manager or
  terminal. (@dbachelder)

### Fixed
- **Markdown rendering** in the overlay transcript, thinking blocks, and saved
  notes, with regression coverage for tables in narrow overlays.
  (@AndrewJacop with test coverage by Dinesh Jinjala, #31)
- **Custom provider support in sub-sessions**: BTW child sessions now preserve
  extension-registered providers and legacy Pi sub-session runtimes, and keep
  the model registry method receiver intact. (@leon-zym, #30)
- **Subscription / keyless auth**: BTW sub-sessions accept subscription-based
  and configured keyless model auth without requiring an API key.
  (@juicetin, #25; follow-up by @dbachelder)
- **Mouse scrolling preserved** across TUI modes so the main session keeps its
  wheel scrolling after BTW opens and closes. (@tschuehly, #32)
- **Overlay dismissal** no longer double-closes stacked overlays or prematurely
  tears down mouse reporting. (@kurihada, #34)
- **RPC hosts**: completed BTW responses are surfaced as visible session notes
  on RPC/SDK hosts that can't open the composer overlay. (@dbachelder, #42)
- **npm package** now includes the bundled `btw` skill. (@dbachelder)

### Changed
- Upgraded to Pi 0.85.1 and added a typecheck step to CI. (@dbachelder)

## [0.4.1] and earlier

See the Git history and GitHub releases for changes prior to 0.5.0.
