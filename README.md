# claude-code-mods

Personal [Claude Code](https://docs.claude.com/en/docs/claude-code) mods, published as one local-style marketplace named `heitor-mods`.

## Install

Requires a Claude Code build with mod (function hooks) support.

**1. Add the marketplace.** The repository is private, so `gh auth login` (or any git credential that can read it) must work first.

```bash
claude plugin marketplace add fhva29/claude-code-mods
```

Or clone it and add the folder; Claude Code then reads the mods straight from it, so an edit plus `/reload-plugins` is enough, with no reinstall:

```bash
git clone https://github.com/fhva29/claude-code-mods ~/.claude/mods
claude plugin marketplace add ~/.claude/mods
```

**2. Install the mods you want** (user scope):

```bash
claude plugin install next-lite@heitor-mods
claude plugin install tidy-tools@heitor-mods
# ...or all of them:
for m in blast-radius commit-gate model-stack next-lite pixel-quest prompt-git \
         replay-theater tidy-tools usage-weather venv-guard; do
  claude plugin install "$m@heitor-mods"
done
```

**3. Reload** inside Claude Code with `/reload-plugins`.

Options (`userConfig`) are set in `/plugin` → pick the mod → configure, then `/reload-plugins`. They are stored in `~/.claude/settings.json` under `pluginConfigs`.

## Mods

| Mod | What it does | Command |
|---|---|---|
| [`next-lite`](next-lite) | Suggests up to three next prompts above the input (press `1`/`2`/`3` to fill the prompt box, `0` to dismiss; the top one is also Tab ghost text). Sends a ~1–2k token digest of the turn to a small model instead of forking the whole session, so its cost does not grow with the conversation. Replacement for `next-steps`. Options: `mode` (`auto`/`manual`), `model`, `minAnswerChars`, `suggestSkills`. | `/next` |
| [`model-stack`](model-stack) | Routes the model and effort of the main chat turn and of each subagent with TypeSafe's Jev, and shows the roster, decisions and agent graph in a pane. Needs `TYPESAFE_API_KEY` in the environment. | `/stack` |
| [`tidy-tools`](tidy-tools) | Draws each tool call as one compact line, or folds a whole turn into one "N steps this turn" line. | `/lines` |
| [`blast-radius`](blast-radius) | Holds risky shell commands (`rm -rf`, `git reset --hard`, `git clean`, force push, migrations) and shows what they would change, with Proceed and Cancel buttons. | |
| [`commit-gate`](commit-gate) | Holds `git commit` in a pane listing the staged files, flags files not edited this session and blocks AI attribution trailers. | |
| [`replay-theater`](replay-theater) | Steps through the file edits Claude made in the last turn, one diff at a time. | `/replay` |
| [`usage-weather`](usage-weather) | A forecast band above the prompt: context fill, sparkline, rate limits, model and effort. | |
| [`prompt-git`](prompt-git) | Appends the git branch and working-tree counts to the hint line under the prompt. | |
| [`venv-guard`](venv-guard) | Rewrites Bash calls to use `BackEnd/venv/bin` explicitly instead of `source activate`. Specific to the Wellnova repo layout. | |
| [`pixel-quest`](pixel-quest) | Replaces the spinner with a pixel RPG scene for each tool, with XP, levels and achievements. No model calls. | `/toons` |

[`_archive`](_archive) holds mods that are kept but not in use (`branch-hud`); they are not listed in the marketplace.

## Development

Each mod is a folder with `.claude-plugin/plugin.json`, `hooks/hooks.json` and a hooks module (`register.ts` or `register.tsx`). Check one with:

```bash
claude plugin validate <mod>
claude plugin test <mod>
```

`claude plugin test` does not type-check; run `tsc` against the SDK declarations Claude Code writes to `<mod>/.claude-plugin/types/` as well.

`next-lite` builds on [`next-steps`](https://github.com/anthropics/claude-plugins-community) (MIT, Thariq Shihipar): it reuses the text sanitizer and the reply parsing, and replaces the session fork with a small digest.
