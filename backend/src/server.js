import http from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { getDb } from './db/index.js';
import { attachRealtime } from './realtime/hub.js';

getDb();

const server = http.createServer(createApp());
attachRealtime(server);

server.listen(config.port, () => {
  console.log(`Cricket Polls API listening on http://localhost:${config.port}`);
  console.log(`  WebSocket:  ws://localhost:${config.port}/ws`);
  console.log(`  Database:   ${config.databaseFile}`);
  if (!config.adminPassword) {
    console.warn('  WARNING: ADMIN_PASSWORD is unset -- the admin API is disabled.');
  }
});
