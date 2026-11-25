import crypto from 'crypto';
import { Router } from 'express';
import { Room } from '../models/Room.js';
import { Message } from '../models/Message.js';
import { CallRing } from '../models/CallRing.js';
import { requireAuth } from '../middleware/auth.js';
import { presentRoom } from '../utils/present.js';
import { areFriends } from '../utils/friends.js';
import { emitToRoom } from '../socket.js';

const router = Router();
router.use(requireAuth);

const kinds = new Set(['friends', 'couple', 'family', 'call']);
const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';

async function makeCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const bytes = crypto.randomBytes(6);
    const code = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
    const exists = await Room.exists({ code });
    if (!exists) return code;
  }
  throw new Error('Could not create a room code');
}

async function loadRoom(id) {
  return Room.findById(id).populate('members', 'name color personalId');
}

async function recentMessages(roomId) {
  const messages = await Message.find({ room: roomId })
    .sort({ createdAt: -1 })
    .limit(80)
    .populate('sender', 'name color personalId');
  return messages.reverse();
}

function isMember(room, userId) {
  return room.members.some((member) => String(member._id || member) === String(userId));
}

router.get('/', async (req, res, next) => {
  try {
    const rooms = await Room.find({ members: req.user.id })
      .sort({ updatedAt: -1 })
      .populate('members', 'name color personalId');
    res.json({ rooms: rooms.map((room) => presentRoom(room)) });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const kind = String(req.body.kind || '');
    const friendIds = Array.isArray(req.body.friendIds) ? [...new Set(req.body.friendIds.map(String))] : [];

    if (name.length < 2 || name.length > 60) {
      return res.status(400).json({ message: 'Give the room a name, 2 to 60 characters.' });
    }
    if (!kinds.has(kind)) return res.status(400).json({ message: 'Pick friends, couple, family, or a call.' });
    if (friendIds.length > 7) return res.status(400).json({ message: 'Start with 8 people or fewer.' });

    for (const friendId of friendIds) {
      if (friendId === req.user.id || !(await areFriends(req.user.id, friendId))) {
        return res.status(400).json({ message: 'You can only add people you are friends with.' });
      }
    }

    const room = await Room.create({
      name,
      kind,
      code: await makeCode(),
      host: req.user.id,
      members: [req.user.id, ...friendIds]
    });
    const full = await loadRoom(room._id);
    res.status(201).json({ room: presentRoom(full) });
  } catch (err) {
    next(err);
  }
});

router.post('/join', async (req, res, next) => {
  try {
    const code = String(req.body.code || '').trim().toLowerCase();
    const room = await Room.findOne({ code });
    if (!room) return res.status(404).json({ message: 'No room with that code.' });
    if (!isMember(room, req.user.id)) {
      if (room.members.length >= 8) return res.status(400).json({ message: 'This room is full (8 people).' });
      room.members.push(req.user.id);
      await room.save();
    }
    const full = await loadRoom(room._id);
    const presented = presentRoom(full);
    emitToRoom(presented.id, 'roster', { members: presented.members, hostId: presented.hostId });
    res.json({ room: presented });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const room = await loadRoom(req.params.id);
    if (!room || !isMember(room, req.user.id)) {
      return res.status(404).json({ message: 'That room is not yours.' });
    }
    const messages = await recentMessages(room._id);
    res.json({ room: presentRoom(room, messages) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/members', async (req, res, next) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room || !isMember(room, req.user.id)) {
      return res.status(404).json({ message: 'That room is not yours.' });
    }
    const userId = String(req.body.userId || '');
    if (isMember(room, userId)) return res.status(409).json({ message: 'They are already in the room.' });
    if (room.members.length >= 8) return res.status(400).json({ message: 'This room is full (8 people).' });
    if (!(await areFriends(req.user.id, userId))) {
      return res.status(400).json({ message: 'Add a friend first.' });
    }
    room.members.push(userId);
    await room.save();
    const full = await loadRoom(room._id);
    const presented = presentRoom(full);
    emitToRoom(presented.id, 'roster', { members: presented.members, hostId: presented.hostId });
    res.json({ room: presented });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/members/me', async (req, res, next) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room || !isMember(room, req.user.id)) {
      return res.status(404).json({ message: 'That room is not yours.' });
    }

    room.members.pull(req.user.id);
    if (room.members.length === 0) {
      await Message.deleteMany({ room: room._id });
      await room.deleteOne();
      return res.json({ deleted: true });
    }

    if (room.host.equals(req.user.id)) room.host = room.members[0];
    await room.save();
    const full = await loadRoom(room._id);
    const presented = presentRoom(full);
    emitToRoom(presented.id, 'roster', { members: presented.members, hostId: presented.hostId });
    res.json({ deleted: false, room: presented });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room || !isMember(room, req.user.id)) {
      return res.status(404).json({ message: 'That room is not yours.' });
    }
    emitToRoom(room._id.toString(), 'room-closed', { id: room._id.toString() });
    await Message.deleteMany({ room: room._id });
    await CallRing.deleteMany({ room: room._id });
    await room.deleteOne();
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

export default router;
