/**
 * Entry point. Socket Mode by default, so you can play a game from your
 * laptop without a public URL or a tunnel; set SLACK_MODE=http if you are
 * deploying somewhere with an address.
 */

import { App, LogLevel } from '@slack/bolt';
import { registerHandlers, SLASH_COMMAND } from './app.js';
import { createMemoryStore } from './store.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env and fill it in — the README says where each value comes from.`);
    process.exit(1);
  }
  return value;
}

const useSocketMode = (process.env['SLACK_MODE'] ?? 'socket') !== 'http';

const app = new App({
  token: required('SLACK_BOT_TOKEN'),
  ...(useSocketMode
    ? { socketMode: true as const, appToken: required('SLACK_APP_TOKEN') }
    : { signingSecret: required('SLACK_SIGNING_SECRET') }),
  logLevel: process.env['LOG_LEVEL'] === 'debug' ? LogLevel.DEBUG : LogLevel.INFO,
});

registerHandlers(app, { store: createMemoryStore() });

const port = Number(process.env['PORT'] ?? 3000);

if (useSocketMode) {
  await app.start();
} else {
  await app.start(port);
}

console.log(
  useSocketMode
    ? `Tic Tac Toe² is listening over Socket Mode. Type ${SLASH_COMMAND} in any channel the app is in.`
    : `Tic Tac Toe² is listening on :${port}. Type ${SLASH_COMMAND} in any channel the app is in.`,
);
