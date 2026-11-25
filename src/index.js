import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(backendRoot, '.env') });
import cors from 'cors';
import { Server } from 'socket.io';
import { connectDb, getDbMode } from './config/db.js';
import authRoutes from './routes/auth.js';
import friendRoutes from './routes/friends.js';
import chatRoutes from './routes/chats.js';
import storyRoutes from './routes/stories.js';
import roomRoutes from './routes/rooms.js';
import { registerSocket } from './socket.js';

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is missing. Copy backend/.env.example to backend/.env.');
  process.exit(1);
}

const allowed = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function allowOrigin(origin, callback) {
  if (!origin || allowed.includes(origin)) return callback(null, true);
  try {
    if (new URL(origin).hostname.endsWith('.vercel.app')) return callback(null, true);
  } catch {
    return callback(null, false);
  }
  return callback(null, false);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: allowOrigin } });

app.use(cors({ origin: allowOrigin }));
app.use(express.json({ limit: '200kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: getDbMode() });
});

app.use('/api/auth', authRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/stories', storyRoutes);
app.use('/api/rooms', roomRoutes);

const uploadsDir = path.join(backendRoot, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api|\/socket\.io|\/uploads).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((err, _req, res, _next) => {
  if (err.name === 'CastError') return res.status(404).json({ message: 'Not found.' });
  console.error(err);
  res.status(500).json({ message: 'Something went wrong.' });
});

registerSocket(io);

const port = Number(process.env.PORT) || 5000;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the other backend, then run npm run dev again.`);
    process.exit(1);
  }
  throw err;
});
connectDb()
  .then(() => {
    server.listen(port, () => console.log(`Hearth API listening on ${port}`));
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
