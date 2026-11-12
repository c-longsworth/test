# Tic Tac Toe²

Nine games of tic tac toe inside a game of tic tac toe, played in Slack.
Win a small board to claim its square on the big one.

```
⬜🔵🔵 🔵⬜❌ ⬜⬜⬜
⬜⬜❌ 🔵⬜⬜ 🔵🔵❌
⬜⬜⬜ ⬜❌⬜ ⬜❌❌

🟥🟥🟥 🟦🟦🟦 ❌🔵🟨
🟥🟥🟥 🟦🟦🟦 🔵❌🔵
🟥🟥🟥 🟦🟦🟦 🟨🟨🟨

⬜⬜⬜ ⬜⬜⬜ 🟥🟥🟥
⬜⬜⬜ 🔵⬜🔵 🟥🟥🟥
⬜⬜🔵 ⬜⬜🔵 🟥🟥🟥

❌ @ada — you are sent to board 6.
```

❌ has claimed boards 1 and 7, 🔵 has board 4. The yellow squares are where
❌ can play this turn, and they had no say in it.

## The rules

- Win one of the nine small boards and you claim its square on the big board.
- Three claimed squares in a row wins the match.
- **The catch:** the square you play in decides which board your opponent
  plays in next. Play the centre square and they are sent to the centre
  board. This is the entire game — you are always choosing between the move
  you want and the board you are about to hand over.
- If they are sent to a board that is already won or full, they may play
  anywhere.
- A drawn small board claims nothing, for either player.
- If every board ends up settled with no line, whoever claimed more boards
  takes the match. (A house rule — see *Changing things* below.)

## Playing

| | |
|---|---|
| `/ttt2 @someone` | challenge them |
| `/ttt2` | post an open game anyone can join |
| `/ttt2 help` | the rules, as an ephemeral message |

The challenger is ❌ and moves first. One board message per game, edited in
place as you play, so a game is one message in the channel rather than
sixty-nine.

Taps are checked against the rules, not against the buttons: play out of turn
or in the wrong board and you get a private "not your turn", and nobody else
sees anything.

## Setting it up

You need a Slack workspace you can install an app into. Socket Mode is the
default, so you do **not** need a public URL or a tunnel.

**1. Create the app.** Go to [api.slack.com/apps](https://api.slack.com/apps)
→ *Create New App* → *From an app manifest*, pick your workspace, and paste
in [`manifest.json`](./manifest.json). It sets the `/ttt2` command, the bot
scopes, and the one setting people usually miss: `should_escape`, which is
what makes `/ttt2 @someone` resolve to a real user instead of the text
`@someone`.

**2. Get two tokens.**

- *Basic Information* → *App-Level Tokens* → generate one with the
  `connections:write` scope. That is your `SLACK_APP_TOKEN` (`xapp-…`).
- *OAuth & Permissions* → *Install to Workspace*. The Bot User OAuth Token it
  gives you is your `SLACK_BOT_TOKEN` (`xoxb-…`).

**3. Run it.**

```bash
npm install
cp .env.example .env    # paste the two tokens in
npm run dev             # or: npm run build && npm start
```

Then type `/ttt2` in any channel. The app posts with `chat:write.public`, so
it does not need inviting to public channels first.

Prefer HTTP to Socket Mode? Set `SLACK_MODE=http` and `SLACK_SIGNING_SECRET`,
turn Socket Mode off in the app settings, and point *Interactivity* and the
slash command at `https://your-host/slack/events`.

### No workspace handy

```bash
npm run demo        # plays a random game out in the terminal
npm run demo 4242   # ...the same one every time
```

## How it is put together

```
src/game.ts    the rules. no Slack, no I/O, pure functions
src/render.ts  GameState -> Block Kit
src/store.ts   where games live
src/app.ts     taps in, edited messages out
src/index.ts   boot
src/demo.ts    terminal playthrough
```

`game.ts` knows nothing about Slack, which is why the rules can be tested
properly — including 200 random self-play games that re-check every invariant
after every move.

Three decisions worth knowing about:

**Two taps on a free turn.** When you are sent to a settled board you may
play anywhere, which is 81 legal squares. Slack has no way to disable a
button, so the options were a wall of 81 buttons or picking a board and then
a square. It picks the board first, and the *← Different board* button takes
it back. Tapping a board commits you to nothing — `legalMoves` deliberately
ignores it.

**Buttons are labelled with their own position.** A board with squares 1, 2
and 5 taken renders as `[3][4]` / `[6]` / `[7][8][9]`. The label says where
the square is, so a row with gaps still reads correctly.

**Games live in memory.** Restart the app and games in flight are gone — the
handlers say so plainly rather than acting as though the board never existed.
Fine for a game you finish in an afternoon. To make it durable, implement the
four-method `GameStore` interface in `store.ts` against Redis or a table and
pass it to `registerHandlers`; nothing else changes, because `GameState` is
already a plain JSON-serialisable object.

## Changing things

**Colours and marks.** Everything the board is drawn with is in `GLYPHS` at
the top of `src/render.ts`. Swap in your workspace's custom emoji if you
like — they are only ever rendered, never parsed.

**A lineless finish should be a draw.** The most-boards rule is in
`resolveOutcome` in `src/game.ts`. Delete the count and return
`{ winner: null, reason: 'draw', line: null }` instead; the tests that cover
it are named for the rule, so they will tell you what you changed.

**Who goes first.** The challenger is always ❌, in `createGame`. A coin flip
is two lines, but then an injectable source of randomness for the tests.

## Tests

```bash
npm test        # 64 tests, no Slack needed
npm run typecheck
```

The interesting ones: the forcing rule (the thing that makes this a game),
the lineless finish, that a rejected move leaves the state untouched, that
`legalMoves` and the rendered buttons never disagree, and that no position
can produce a message Slack would refuse to post — block counts, elements per
block, duplicate action IDs, text lengths.

What the tests do *not* cover is Slack itself: no workspace was available
here, so the Bolt wiring in `app.ts` has been typechecked and reasoned
through but never had a real tap go through it. If something is wrong, that
is where it is.
