# Changelog

All notable changes to this project are documented here.

## [0.6.1] - 2026-09-23

Requires Pi 0.85.1 or newer.

### Fixed
- **Contextual BTW threads on Pi 0.87+**: `/btw`, `/btw:new`, and `/btw:ask`
  inherit the main-session context again. Child sessions now seed Pi's
  `SessionManager` before creation instead of assigning
  `session.agent.state.messages` afterward, which Pi 0.87.0 stopped honoring as
  the source of provider context. `/btw:tangent` stays intentionally
  contextless. (@evanqhuang, #48, #49)

## [0.6.0] - 2026-09-22

Requires Pi 0.85.1 or newer.

### Added
- **Read-only side questions**: `/btw:ask` opens an enforced read-only side
  thread. It inherits the current main-session context like `/btw`, but its
  child session exposes only pi's built-in read-only tools (`read`, `grep`,
  `find`, `ls`) — `bash`, `edit`, and `write` are never available, so the
  boundary is structural rather than prompt-based. The overlay labels the
  thread as read-only, the mode persists with the hidden BTW thread state, and
  switching between `/btw`, `/btw:tangent`, and `/btw:ask` recreates the child
  session so the tool surface always matches the active mode. Supports
  `--save` and continuous follow-ups. (@RooTooRD, #45; implemented in #47)
- **`/side` alias**: `/side` is registered as an alias for the `/btw` entry
  command, matching the equivalent command in Codex. It shares the same thread,
  overlay, persistence, model, and thinking settings as `/btw`; the `/btw:*`
  lifecycle namespace stays canonical. (@RooTooRD, #44; implemented in #46)

### Documentation
- Added a **DeepSeek Harness** section covering the `pi2dsh` bridge on DSH Web,
  including the `dsh-work-x` suite and the minimal `pi2dsh` + `pi-btw` install.
  (@weijiafu14, #35; #43)

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
