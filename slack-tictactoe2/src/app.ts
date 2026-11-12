/**
 * Slack wiring. Everything in here is plumbing — the rules are in game.ts and
 * the pixels are in render.ts, so this file only translates taps into moves
 * and moves back into an edited message.
 */

import type { App, SlackCommandMiddlewareArgs } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import {
  applyMove,
  clearPendingBoard,
  createGame,
  joinGame,
  pickBoard,
  resign,
  type GameState,
  type Result,
} from './game.js';
import { ACTION, decodeBoard, decodeMove, renderGame } from './render.js';
import { newGameId, type GameStore } from './store.js';

export const SLASH_COMMAND = '/ttt2';

const HELP = [
  '*Tic Tac Toe²* — nine games of tic tac toe inside one.',
  '',
  `• \`${SLASH_COMMAND} @someone\` — challenge them`,
  `• \`${SLASH_COMMAND}\` — post an open game for anyone to join`,
  `• \`${SLASH_COMMAND} help\` — this`,
  '',
  '*The rules*',
  '• Win one of the nine small boards to claim its square on the big board.',
  '• Three claimed squares in a row wins the match.',
  '• *The catch:* the square you play in decides which board your opponent plays in next. Play the centre square and they are sent to the centre board.',
  '• If they are sent to a board that is already won or full, they may play anywhere.',
  '• If every board is settled with no line, whoever claimed more boards takes it.',
].join('\n');

/** Slack sends `<@U123|name>` only with link escaping on; `@name` otherwise. */
export function parseOpponent(text: string): { userId: string } | { unresolved: string } | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;

  const escaped = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/.exec(trimmed);
  if (escaped) return { userId: escaped[1]! };

  const plain = /^@(\S+)/.exec(trimmed);
  if (plain) return { unresolved: plain[1]! };

  return null;
}

interface Deps {
  store: GameStore;
  makeId?: () => string;
}

export function registerHandlers(app: App, deps: Deps): void {
  const { store } = deps;
  const makeId = deps.makeId ?? newGameId;

  app.command(SLASH_COMMAND, async ({ command, ack, respond, client }) => {
    await ack();

    const text = (command.text ?? '').trim();
    if (/^(help|h|\?)$/i.test(text)) {
      await respond({ response_type: 'ephemeral', text: HELP });
      return;
    }

    const opponent = parseOpponent(text);

    if (opponent && 'unresolved' in opponent) {
      await respond({
        response_type: 'ephemeral',
        text:
          `I can see you typed \`@${opponent.unresolved}\` but Slack did not send me their user ID, ` +
          'so I cannot tell who they are. Either turn on *Escape channels, users, and links* in the ' +
          `slash command's settings, or run \`${SLASH_COMMAND}\` on its own and let them tap *Join*.`,
      });
      return;
    }

    if (opponent && opponent.userId === command.user_id) {
      await respond({
        response_type: 'ephemeral',
        text: 'Playing yourself is a solved game. Challenge someone else.',
      });
      return;
    }

    const state = createGame({
      id: makeId(),
      channel: command.channel_id,
      challenger: command.user_id,
      opponent: opponent ? opponent.userId : null,
    });

    await post(client, store, state, opponent ? opponent.userId : null);
  });

  // Action ids carry their grid position so they stay unique within a message,
  // hence the prefix match rather than an exact one.
  app.action(new RegExp(`^${ACTION.move}_\\d$`), async (args) => {
    await args.ack();
    const value = actionValue(args.payload);
    const decoded = value ? decodeMove(value) : null;
    if (!decoded) return;
    await mutate(args, deps, decoded.gameId, (state, userId) =>
      applyMove(state, userId, decoded.board, decoded.cell));
  });

  app.action(new RegExp(`^${ACTION.pickBoard}_\\d$`), async (args) => {
    await args.ack();
    const value = actionValue(args.payload);
    const decoded = value ? decodeBoard(value) : null;
    if (!decoded) return;
    await mutate(args, deps, decoded.gameId, (state, userId) =>
      pickBoard(state, userId, decoded.board));
  });

  app.action(ACTION.clearBoard, async (args) => {
    await args.ack();
    const gameId = actionValue(args.payload);
    if (!gameId) return;
    await mutate(args, deps, gameId, (state, userId) => clearPendingBoard(state, userId));
  });

  app.action(ACTION.join, async (args) => {
    await args.ack();
    const gameId = actionValue(args.payload);
    if (!gameId) return;
    await mutate(args, deps, gameId, (state, userId) => joinGame(state, userId));
  });

  app.action(ACTION.resign, async (args) => {
    await args.ack();
    const gameId = actionValue(args.payload);
    if (!gameId) return;
    await mutate(args, deps, gameId, (state, userId) => resign(state, userId));
  });
}

function actionValue(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && 'value' in payload) {
    const { value } = payload as { value?: unknown };
    if (typeof value === 'string') return value;
  }
  return null;
}

/** Post a fresh board and remember where it landed, so we can edit it later. */
async function post(
  client: WebClient,
  store: GameStore,
  state: GameState,
  challengedUserId: string | null,
): Promise<void> {
  const rendered = renderGame(state);
  const result = await client.chat.postMessage({
    channel: state.channel,
    text: challengedUserId
      ? `<@${challengedUserId}> — you have been challenged to Tic Tac Toe².`
      : rendered.text,
    blocks: rendered.blocks,
  });

  store.save({ ...state, ts: typeof result.ts === 'string' ? result.ts : null });
}

type ActionArgs = {
  body: unknown;
  client: WebClient;
  respond: (options: { response_type?: 'ephemeral' | 'in_channel'; text: string; replace_original?: boolean }) => Promise<unknown>;
};

/**
 * One path for every tap: load, apply, save, redraw. A rejected move never
 * touches the board — the player who tried it gets told why, privately, and
 * nobody else sees a thing.
 */
async function mutate(
  args: ActionArgs,
  deps: Deps,
  gameId: string,
  transition: (state: GameState, userId: string) => Result<GameState>,
): Promise<void> {
  const userId = actingUserId(args.body);
  if (!userId) return;

  const state = deps.store.get(gameId);
  if (!state) {
    await args.respond({
      response_type: 'ephemeral',
      replace_original: false,
      text: `I have lost track of game \`${gameId}\` — it expired, or the app restarted. Start another with \`${SLASH_COMMAND}\`.`,
    });
    return;
  }

  const result = transition(state, userId);
  if (!result.ok) {
    await args.respond({
      response_type: 'ephemeral',
      replace_original: false,
      text: result.error,
    });
    return;
  }

  const next = result.value;
  deps.store.save(next);

  const rendered = renderGame(next);
  if (next.ts === null) return;

  await args.client.chat.update({
    channel: next.channel,
    ts: next.ts,
    text: rendered.text,
    blocks: rendered.blocks,
  });
}

function actingUserId(body: unknown): string | null {
  if (body && typeof body === 'object' && 'user' in body) {
    const { user } = body as { user?: { id?: unknown } };
    if (user && typeof user.id === 'string') return user.id;
  }
  return null;
}

export type { SlackCommandMiddlewareArgs };
