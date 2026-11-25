import jwt from 'jsonwebtoken';
import { Room } from './models/Room.js';
import { Message } from './models/Message.js';
import { DirectChat } from './models/DirectChat.js';
import { Friendship } from './models/Friendship.js';
import { parseMedia } from './utils/media.js';
import { presentMessage } from './utils/present.js';

let ioInstance = null;
const online = new Map();
const sessions = new Map();

export function emitToRoom(roomId, event, payload) {
  ioInstance?.to(String(roomId)).emit(event, payload);
}

export function emitToUser(userId, event, payload) {
  ioInstance?.to(`user:${String(userId)}`).emit(event, payload);
}

export function isOnline(userId) {
  return (sessions.get(String(userId))?.size || 0) > 0;
}

async function friendIds(userId) {
  const rows = await Friendship.find({
    status: 'accepted',
    $or: [{ requester: userId }, { recipient: userId }]
  }).select('requester recipient');
  return rows.map((row) => (String(row.requester) === String(userId) ? String(row.recipient) : String(row.requester)));
}

async function announcePresence(userId, onlineNow) {
  const friends = await friendIds(userId);
  for (const friendId of friends) emitToUser(friendId, 'presence', { userId: String(userId), online: onlineNow });
}

async function dropPresence(socket) {
  const userId = String(socket.user.id);
  const set = sessions.get(userId);
  set?.delete(socket.id);
  if (!set || set.size === 0) {
    sessions.delete(userId);
    await announcePresence(userId, false);
  }
}

function peersOf(roomId) {
  if (!online.has(roomId)) online.set(roomId, new Map());
  return online.get(roomId);
}

function emitOnline(roomId) {
  const list = [...(online.get(roomId)?.values() || [])];
  emitToRoom(roomId, 'online', list);
}

function leaveRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const peers = online.get(roomId);
  peers?.delete(socket.id);
  if (peers && peers.size === 0) online.delete(roomId);
  socket.leave(roomId);
  socket.to(roomId).emit('peer-left', { socketId: socket.id });
  socket.data.roomId = null;
  emitOnline(roomId);
}

async function memberRoom(roomId, userId) {
  if (!roomId) return null;
  const room = await Room.findById(roomId);
  if (!room || !room.members.some((id) => id.equals(userId))) return null;
  return room;
}

export function registerSocket(io) {
  ioInstance = io;

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = {
        id: payload.id,
        name: payload.name,
        personalId: payload.personalId,
        color: payload.color
      };
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.user.id}`);
    const userId = String(socket.user.id);
    const open = sessions.get(userId) || new Set();
    const wasOffline = open.size === 0;
    open.add(socket.id);
    sessions.set(userId, open);
    friendIds(userId)
      .then((friends) => {
        if (wasOffline) announcePresence(userId, true);
        socket.emit('presence-list', friends.filter((id) => isOnline(id)));
      })
      .catch((err) => console.error(err));

    socket.on('typing', async ({ chatId, typing }) => {
      try {
        if (!chatId) return;
        const chat = await DirectChat.findById(chatId).select('participants');
        if (!chat || !chat.participants.some((person) => person.equals(socket.user.id))) return;
        const other = chat.participants.find((person) => !person.equals(socket.user.id));
        emitToUser(other, 'typing', {
          chatId: String(chat._id),
          userId,
          name: socket.user.name,
          typing: Boolean(typing)
        });
      } catch (err) {
        console.error(err);
      }
    });

    socket.on('join-room', async (roomId) => {
      try {
        const room = await memberRoom(roomId, socket.user.id);
        if (!room) {
          socket.emit('app-error', { message: 'You do not have a seat in this room.' });
          return;
        }

        leaveRoom(socket);
        const id = room._id.toString();
        for (const [socketId, peer] of [...(online.get(id)?.entries() || [])]) {
          if (String(peer.user?.id) !== String(socket.user.id)) continue;
          online.get(id).delete(socketId);
          const old = io.sockets.sockets.get(socketId);
          if (old) {
            old.leave(id);
            if (old.data.roomId === id) old.data.roomId = null;
          }
          io.to(id).emit('peer-left', { socketId });
        }
        socket.data.roomId = id;
        socket.join(id);
        peersOf(id).set(socket.id, { socketId: socket.id, user: socket.user });

        const messages = await Message.find({ room: room._id })
          .sort({ createdAt: -1 })
          .limit(80)
          .populate('sender', 'name color personalId');
        messages.reverse();

        socket.emit('room-state', {
          messages: messages.map(presentMessage),
          media: room.media,
          playback: room.playback,
          online: [...peersOf(id).values()]
        });
        socket.emit(
          'peers',
          [...peersOf(id).values()].filter((peer) => peer.socketId !== socket.id)
        );
        socket.to(id).emit('peer-joined', { socketId: socket.id, user: socket.user });
        emitOnline(id);
      } catch (err) {
        console.error(err);
        socket.emit('app-error', { message: 'Could not join the room.' });
      }
    });

    socket.on('signal', ({ to, description, candidate }) => {
      const roomId = socket.data.roomId;
      if (!roomId || !to) return;
      const target = io.sockets.sockets.get(to);
      if (!target || target.data.roomId !== roomId) return;
      target.emit('signal', {
        from: socket.id,
        user: socket.user,
        description,
        candidate
      });
    });

    socket.on('chat', async ({ text }) => {
      try {
        const roomId = socket.data.roomId;
        const clean = String(text || '').trim().slice(0, 500);
        if (!roomId || !clean) return;
        const room = await memberRoom(roomId, socket.user.id);
        if (!room) return;
        const doc = await Message.create({ room: room._id, sender: socket.user.id, text: clean });
        await Room.updateOne({ _id: room._id }, { updatedAt: new Date() });
        io.to(roomId).emit('message', {
          id: doc._id.toString(),
          text: clean,
          createdAt: doc.createdAt,
          sender: {
            id: String(socket.user.id),
            name: socket.user.name,
            personalId: socket.user.personalId || '',
            color: socket.user.color || '#9a4318'
          }
        });
      } catch (err) {
        console.error(err);
      }
    });

    socket.on('set-media', async ({ url }) => {
      try {
        const roomId = socket.data.roomId;
        const room = await memberRoom(roomId, socket.user.id);
        if (!room || room.kind === 'call') return;
        const parsed = parseMedia(url);
        if (parsed.error) {
          socket.emit('app-error', { message: parsed.error });
          return;
        }
        room.media = parsed.media;
        room.playback = { playing: false, position: 0, updatedAt: new Date() };
        await room.save();
        io.to(roomId).emit('media', { media: room.media, playback: room.playback });
      } catch (err) {
        console.error(err);
      }
    });

    socket.on('playback', async ({ playing, position }) => {
      try {
        const roomId = socket.data.roomId;
        const pos = Number(position);
        if (!roomId || !Number.isFinite(pos) || pos < 0 || pos > 60 * 60 * 12) return;
        const room = await memberRoom(roomId, socket.user.id);
        if (!room || room.kind === 'call') return;
        const playback = { playing: Boolean(playing), position: pos, updatedAt: new Date() };
        await Room.updateOne({ _id: roomId }, { playback });
        io.to(roomId).emit('playback', { ...playback, from: socket.id });
      } catch (err) {
        console.error(err);
      }
    });

    socket.on('cue', async () => {
      if (!socket.data.roomId) return;
      const room = await memberRoom(socket.data.roomId, socket.user.id);
      if (!room || room.kind === 'call') return;
      io.to(socket.data.roomId).emit('cue', { at: Date.now() + 3000 });
    });

    socket.on('share', async ({ sharing }) => {
      if (!socket.data.roomId) return;
      const room = await memberRoom(socket.data.roomId, socket.user.id);
      if (!room || room.kind === 'call') return;
      io.to(socket.data.roomId).emit('share', {
        socketId: socket.id,
        user: socket.user,
        sharing: Boolean(sharing)
      });
    });

    socket.on('react', ({ emoji }) => {
      if (!socket.data.roomId) return;
      const clean = String(emoji || '').trim().slice(0, 8);
      if (!clean) return;
      io.to(socket.data.roomId).emit('reaction', {
        id: `${socket.id}-${Date.now()}`,
        emoji: clean,
        name: socket.user.name
      });
    });

    socket.on('leave-room', () => leaveRoom(socket));
    socket.on('disconnect', () => {
      leaveRoom(socket);
      dropPresence(socket).catch((err) => console.error(err));
    });
  });
}
