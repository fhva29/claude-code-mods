# fhva-skins

A desktop skin for Claude Code. It redraws the transcript in the Code tab of the desktop app:

- **Tool rows** with an icon per kind, a spinner while running, lines changed and time taken. `▸` opens a row to show its input and its answer, and a failed call opens by itself.
- **Edits** as diff cards with `+N −M` and numbered lines.
- **Shell output** as a terminal card: exit status, stderr shown separately, long output folded.
- **Tables and code blocks** as cards with highlighting in the skin's colours. `bash` fences keep the app's Run button.
- **Quiet reads** (on by default): reads, searches and read-only commands fold into one row, while failures stay whole.
- **Usage band** above the prompt: context and plan-limit rings, the model and effort of the main loop (`Opus 5.5 · high`), and a Compact button with a nudge from 70% context.

Themes, all with light and dark variants: `neon` (default, the midnight-neon palette), `tokyo-night`, `dracula`, `catppuccin`, `github`, `nord`, `noir`, `mono`.

The plugin makes no network calls and adds nothing to the system prompt.

## Use

| Command | What it does |
|---|---|
| `/skin` | Settings pane: pick a skin with a preview, toggle parts, repaint a colour |
| `/skin <name>` | Switch skin |
| `/skin list` · `help` | Every skin and setting, or every command |
| `/skin off` · `on` | Claude Code's own drawing, or the skin again |
| `/skin quiet off` | Show every read and search as its own row |
| `/skin calm` | No motion, one line per tool row |

## Conflicts

These mods redraw the same parts of the transcript, so turn them off while this one is on: `usage-weather` (band above the prompt), `tidy-tools` (tool rows), `midnight-neon` (replies), `pixel-quest` (spinner), and `skins@hellosverre-mods` (the upstream).

## Credits

Fork of [hellosverre/claude-skins](https://github.com/hellosverre/claude-skins) 0.5.16 (MIT, see `LICENSE`). Removed from the fork: Mermaid charts, math, the AI skin designer, the daily update check, the chart hint in the system prompt, the `$.skins` API and the terminal-only `terminal` skin.

Tests: `claude plugin test .`
