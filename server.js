import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Server } from 'socket.io';
import storage from './storage/memory.js';
import { registerSockets } from './network/socket.js';
import { PUBLIC_CONFIG } from './game/config.js';

export function createApp({ roomStorage = storage, cleanupIntervalMs, randomSource } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    next();
  });
  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
  app.get('/api/config', (_req, res) => res.json(PUBLIC_CONFIG));
  app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
  const server = createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 8192, serveClient: true });
  const stopCleanup = registerSockets(io, roomStorage, { cleanupIntervalMs, randomSource });
  server.on('close', stopCleanup);
  return { app, server, io };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server, io } = createApp();
  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => console.log(`Capiletras iniciado na porta ${port}.`));
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => io.close(() => process.exit(0)));
  }
}
