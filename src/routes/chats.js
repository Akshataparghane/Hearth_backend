import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { Router } from 'express';
import { CallRing } from '../models/CallRing.js';
import { DirectChat } from '../models/DirectChat.js';
import { DirectMessage } from '../models/DirectMessage.js';
import { Room } from '../models/Room.js';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { areFriends } from '../utils/friends.js';
import { publicUser } from '../utils/present.js';
import { emitToUser, isOnline } from '../socket.js';

const router = Router();
router.use(requireAuth);

const stickerLabels = {
  s01: 'Hug',
  s02: 'I love you',
  s03: 'Kiss',
  s04: 'Haha',
  s05: 'Always with you',
  s06: "It's okay",
  s07: "Don't cry",
  s08: 'Together',
  s09: 'Hmmm',
  s10: 'Shh',
  s11: 'You naughty',
  s12: 'Shh baby',
  s13: 'Cuddle',
  s14: 'Kiss',
  s15: 'Close',
  s16: 'Kiss',
  s17: 'Miss you',
  s18: 'Come here',
  s19: 'Mine',
  s20: 'Good night',
  s21: 'Good morning',
  s22: 'Hmph',
  s23: 'I miss you',
  s24: 'Kiss',
  s25: 'My everything',
  s26: 'Hehe',
  s27: 'Kiss me',
  s28: 'Mmm',
  s29: "You're mine",
  s30: 'Stop it',
  s31: 'I love you',
  s32: 'Hmph',
  s33: 'Lick me',
  s34: 'Baby',
  s35: "Don't look",
  s36: 'Muahh',
  s37: 'I want you',
  s38: 'Just you',
  s39: 'Come here',
  s40: 'You idiot',
  s41: 'Be mine',
  s42: 'Play with me',
  s43: 'Good night',
  s44: 'Shower together',
  s45: 'You make me crazy',
  s46: 'I miss you',
  s47: "Let's make out",
  s48: 'Naughty boy',
  s49: "You're so hot",
  s50: 'Muaaah',
  s51: 'Cutiee',
  s52: 'Mine',
  s53: 'Looking at you',
  s54: "Hey, don't touch",
  s55: 'Nooo',
  s56: 'Babe',
  s57: 'I love you',
  s58: "You're so annoying",
  s59: 'Too innocent',
  s60: 'You are mine',
  s61: 'Behave',
  s62: 'Ahh',
  s63: 'Hmph',
  s64: 'Guess who',
  s65: 'Always together',
  s66: 'Hey beautiful',
  s67: 'Miss me',
  s68: 'Catch me',
  s69: 'All yours',
  s70: 'Thinking of you',
  s71: "You're mine",
  s72: 'Oh really',
  s73: 'Cuddle',
  s74: 'Shh',
  s75: 'Challenge accepted',
  s76: 'Come here',
  s77: 'Trust me',
  s78: 'Caught you',
  s79: 'Too hot',
  s80: 'Coffee date',
  s81: 'Hey there',
  s82: "What's up",
  s83: 'Haha',
  s84: 'For you',
  s85: 'Ready',
  s86: 'Miss you',
  s87: "Let's go",
  s88: 'Gotcha',
  s89: 'Just for you',
  s90: 'Hey'
};
const stickers = new Set(Object.keys(stickerLabels));
const uploadsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase().slice(0, 8);
      cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
    }
  }),
  limits: { fileSize: 24 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype) || /^video\/(mp4|webm|ogg|quicktime)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Send a photo (jpg, png, gif, webp) or a video (mp4, webm, mov).'));
  }
});

function pairKey(a, b) {
  return [String(a), String(b)].sort().join(':');
}

function otherParticipant(chat, me) {
  return (chat.participants || []).find((person) => !person._id.equals(me));
}

function presentChat(chat, me) {
  const person = otherParticipant(chat, me);
  const alias = (chat.aliases || []).find((item) => item.user && item.user.equals(me))?.name || '';
  return {
    id: chat._id.toString(),
    person: { ...publicUser(person), alias, online: isOnline(person?._id) },
    archived: (chat.archivedBy || []).some((item) => item.equals(me)),
    lastText: chat.lastText || '',
    lastAt: chat.lastAt || chat.updatedAt
  };
}

function presentDirect(message, viewerId) {
  const senderId = message.sender?._id ? message.sender._id.toString() : String(message.sender || '');
  const mine = senderId === String(viewerId || '');
  const viewOnce = Boolean(message.viewOnce);
  const opened = Boolean(message.openedAt);
  return {
    id: message._id.toString(),
    chatId: message.chat.toString(),
    kind: message.kind || 'text',
    text: message.text || '',
    media: viewOnce && opened && !mine ? '' : message.media || '',
    viewOnce,
    opened,
    read: Boolean(message.readAt),
    forwarded: Boolean(message.forwarded),
    reply: message.reply?.text || message.reply?.kind
      ? { id: message.reply.id || '', name: message.reply.name || '', kind: message.reply.kind || '', text: message.reply.text || '' }
      : null,
    createdAt: message.createdAt,
    sender: publicUser(message.sender)
  };
}

async function replyFields(chatId, replyTo) {
  const id = String(replyTo || '');
  if (!id) return {};
  const source = await DirectMessage.findOne({ _id: id, chat: chatId }).populate('sender', 'name');
  if (!source) return {};
  const text = source.viewOnce
    ? 'View once photo'
    : source.kind === 'image'
      ? 'Photo'
      : source.kind === 'video'
        ? 'Video'
        : source.kind === 'sticker'
          ? stickerLabels[source.media] || 'Sticker'
          : String(source.text || '').slice(0, 140);
  return { reply: { id: source._id.toString(), name: source.sender?.name || 'Message', kind: source.kind || 'text', text } };
}

function previewText(kind, text, sticker) {
  if (kind === 'image') return 'Photo';
  if (kind === 'video') return 'Video';
  if (kind === 'sticker') return stickerLabels[sticker] || 'Sticker';
  return text;
}

function presentRing(ring, fromUser) {
  return {
    id: ring._id.toString(),
    chatId: ring.chat.toString(),
    roomId: ring.room.toString(),
    status: ring.status,
    to: ring.to.toString(),
    from: publicUser(fromUser)
  };
}

async function markRead(chat, readerId) {
  const unread = await DirectMessage.find({
    chat: chat._id,
    sender: { $ne: readerId },
    readAt: null
  }).select('_id');
  if (!unread.length) return;
  await DirectMessage.updateMany({ _id: { $in: unread.map((item) => item._id) } }, { $set: { readAt: new Date() } });
  const other = otherParticipant(chat, readerId);
  if (other) {
    emitToUser(other._id, 'direct-read', {
      chatId: chat._id.toString(),
      ids: unread.map((item) => item._id.toString())
    });
  }
}

async function loadChat(id, me) {
  const chat = await DirectChat.findById(id).populate('participants', 'name color personalId avatar');
  if (!chat || !chat.participants.some((person) => person._id.equals(me))) return null;
  return chat;
}

const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';

async function makeCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const bytes = crypto.randomBytes(6);
    const code = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
    if (!(await Room.exists({ code }))) return code;
  }
  throw new Error('Could not create a room code');
}

async function settleRing(id, userId, side, status) {
  const ring = await CallRing.findById(id).populate('from', 'name color personalId avatar');
  if (!ring || ring.status !== 'ringing') return null;
  const actor = side === 'from' ? ring.from._id || ring.from : ring.to;
  if (!actor.equals(userId)) return null;
  ring.status = status;
  await ring.save();
  const payload = presentRing(ring, ring.from);
  emitToUser(ring.from._id || ring.from, 'call-update', payload);
  emitToUser(ring.to, 'call-update', payload);
  return ring;
}

async function missRing(id) {
  const ring = await CallRing.findById(id).populate('from', 'name color personalId avatar');
  if (!ring || ring.status !== 'ringing') return;
  ring.status = 'missed';
  await ring.save();
  const payload = presentRing(ring, ring.from);
  emitToUser(ring.from._id, 'call-update', payload);
  emitToUser(ring.to, 'call-update', payload);
}

router.get('/', async (req, res, next) => {
  try {
    const me = req.user.id;
    const chats = await DirectChat.find({ participants: me })
      .sort({ lastAt: -1 })
      .populate('participants', 'name color personalId avatar');
    res.json({ chats: chats.map((chat) => presentChat(chat, me)) });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const me = req.user.id;
    const userId = String(req.body.userId || '');
    if (!(await areFriends(me, userId))) {
      return res.status(400).json({ message: 'You can only message a friend.' });
    }
    const pair = pairKey(me, userId);
    let chat = await DirectChat.findOne({ pair }).populate('participants', 'name color personalId avatar');
    if (!chat) {
      chat = await DirectChat.create({ pair, participants: [me, userId] });
      chat = await chat.populate('participants', 'name color personalId avatar');
    }
    res.status(201).json({ chat: presentChat(chat, me) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/messages', async (req, res, next) => {
  try {
    const chat = await loadChat(req.params.id, req.user.id);
    if (!chat) return res.status(404).json({ message: 'That chat is not open.' });
    const messages = await DirectMessage.find({ chat: chat._id })
      .sort({ createdAt: -1 })
      .limit(80)
      .populate('sender', 'name color personalId avatar');
    messages.reverse();
    await markRead(chat, req.user.id);
    res.json({ chat: presentChat(chat, req.user.id), messages: messages.map((message) => presentDirect(message, req.user.id)) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/messages', async (req, res, next) => {
  try {
    const chat = await loadChat(req.params.id, req.user.id);
    if (!chat) return res.status(404).json({ message: 'That chat is not open.' });
    const text = String(req.body.text || '').trim().slice(0, 500);
    const kind = String(req.body.kind || 'text');
    const sticker = String(req.body.sticker || '');
    if (kind === 'sticker') {
      if (!stickers.has(sticker)) return res.status(400).json({ message: 'That sticker is not available.' });
    } else if (kind !== 'text' || !text) {
      return res.status(400).json({ message: 'Write a message first.' });
    }
    const other = otherParticipant(chat, req.user.id);
    if (!other || !(await areFriends(req.user.id, other._id))) {
      return res.status(400).json({ message: 'You can only message a friend.' });
    }
    const doc = await DirectMessage.create({
      chat: chat._id,
      sender: req.user.id,
      kind: kind === 'sticker' ? 'sticker' : 'text',
      text: kind === 'sticker' ? '' : text,
      media: kind === 'sticker' ? sticker : '',
      ...(await replyFields(chat._id, req.body.replyTo))
    });
    chat.lastText = previewText(doc.kind, text, sticker);
    chat.lastAt = doc.createdAt;
    await chat.save();
    const populated = await doc.populate('sender', 'name color personalId avatar');
    const mine = presentDirect(populated, req.user.id);
    emitToUser(req.user.id, 'direct', mine);
    emitToUser(other._id, 'direct', presentDirect(populated, other._id));
    res.status(201).json({ message: mine });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/media', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ message: err.message || 'That file could not be sent.' });
      if (!req.file) return res.status(400).json({ message: 'Choose a photo or video.' });
      const chat = await loadChat(req.params.id, req.user.id);
      if (!chat) return res.status(404).json({ message: 'That chat is not open.' });
      const other = otherParticipant(chat, req.user.id);
      if (!other || !(await areFriends(req.user.id, other._id))) {
        return res.status(400).json({ message: 'You can only message a friend.' });
      }
      const kind = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
      const viewOnce = kind === 'image' && (req.body.viewOnce === '1' || req.body.viewOnce === 'true');
      const doc = await DirectMessage.create({
        chat: chat._id,
        sender: req.user.id,
        kind,
        viewOnce,
        media: `/uploads/${req.file.filename}`,
        ...(await replyFields(chat._id, req.body.replyTo))
      });
      chat.lastText = viewOnce ? 'View once photo' : previewText(kind, '');
      chat.lastAt = doc.createdAt;
      await chat.save();
      const populated = await doc.populate('sender', 'name color personalId avatar');
      const mine = presentDirect(populated, req.user.id);
      emitToUser(req.user.id, 'direct', mine);
      emitToUser(other._id, 'direct', presentDirect(populated, other._id));
      res.status(201).json({ message: mine });
    } catch (error) {
      next(error);
    }
  });
});

router.post('/:id/forward', async (req, res, next) => {
  try {
    const target = await loadChat(req.params.id, req.user.id);
    const sourceChat = await loadChat(String(req.body.from || ''), req.user.id);
    if (!target || !sourceChat) return res.status(404).json({ message: 'That chat is not open.' });
    const message = await DirectMessage.findOne({ _id: req.body.messageId, chat: sourceChat._id });
    if (!message) return res.status(404).json({ message: 'That message is gone.' });
    if (message.viewOnce) return res.status(400).json({ message: 'A view-once photo cannot be forwarded.' });
    const other = otherParticipant(target, req.user.id);
    if (!other || !(await areFriends(req.user.id, other._id))) {
      return res.status(400).json({ message: 'You can only message a friend.' });
    }
    const doc = await DirectMessage.create({
      chat: target._id,
      sender: req.user.id,
      kind: message.kind,
      text: message.text,
      media: message.media,
      forwarded: true
    });
    target.lastText = message.viewOnce ? 'View once photo' : previewText(doc.kind, doc.text, doc.media);
    target.lastAt = doc.createdAt;
    await target.save();
    const populated = await doc.populate('sender', 'name color personalId avatar');
    const mine = presentDirect(populated, req.user.id);
    emitToUser(req.user.id, 'direct', mine);
    emitToUser(other._id, 'direct', presentDirect(populated, other._id));
    res.status(201).json({ message: mine });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/messages/:messageId', async (req, res, next) => {
  try {
    const chat = await loadChat(req.params.id, req.user.id);
    if (!chat) return res.status(404).json({ message: 'That chat is not open.' });
    const message = await DirectMessage.findOne({ _id: req.params.messageId, chat: chat._id });
    if (!message) return res.status(404).json({ message: 'That message is gone.' });
    await message.deleteOne();
    const last = await DirectMessage.findOne({ chat: chat._id }).sort({ createdAt: -1 });
    chat.lastText = last ? (last.viewOnce ? 'View once photo' : previewText(last.kind, last.text, last.media)) : '';
    chat.lastAt = last?.createdAt || new Date();
    await chat.save();
    const payload = { chatId: chat._id.toString(), messageId: String(req.params.messageId), lastText: chat.lastText, lastAt: chat.lastAt };
    for (const person of chat.participants) emitToUser(person._id, 'direct-delete', payload);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/read', async (req, res, next) => {
  try {
    const chat = await loadChat(req.params.id, req.user.id);
    if (!chat) return res.status(404).json({ message: 'That chat is not open.' });
    await markRead(chat, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/messages/:messageId/open', async (req, res, next) => {
  try {
    const chat = await loadChat(req.params.id, req.user.id);
    if (!chat) return res.status(404).json({ message: 'That chat is not open.' });
    const message = await DirectMessage.findOne({ _id: req.params.messageId, chat: chat._id }).populate(
      'sender',
      'name color personalId avatar'
    );
    if (!message?.viewOnce) return res.status(404).json({ message: 'That photo is gone.' });
    const first = !message.openedAt && !message.sender.equals(req.user.id);
    if (first) {
      message.openedAt = new Date();
      await message.save();
    }
    const mine = presentDirect(message, req.user.id);
    if (first) mine.media = message.media;
    emitToUser(message.sender._id, 'direct', presentDirect(message, message.sender._id));
    emitToUser(req.user.id, 'direct', presentDirect(message, req.user.id));
    if (!first && !message.sender.equals(req.user.id)) {
      return res.status(410).json({ message: 'This photo was already opened.' });
    }
    res.json({ message: mine });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const chat = await loadChat(req.params.id, req.user.id);
    if (!chat) return res.status(404).json({ message: 'That chat is not open.' });
    if ('archived' in req.body) {
      const on = Boolean(req.body.archived);
      const has = (chat.archivedBy || []).some((item) => item.equals(req.user.id));
      if (on && !has) chat.archivedBy.push(req.user.id);
      if (!on && has) chat.archivedBy = chat.archivedBy.filter((item) => !item.equals(req.user.id));
    }
    if ('alias' in req.body) {
      const name = String(req.body.alias || '').trim().slice(0, 40);
      chat.aliases = (chat.aliases || []).filter((item) => item.user && !item.user.equals(req.user.id));
      if (name) chat.aliases.push({ user: req.user.id, name });
    }
    await chat.save();
    res.json({ chat: presentChat(chat, req.user.id) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/messages', async (req, res, next) => {
  try {
    const chat = await loadChat(req.params.id, req.user.id);
    if (!chat) return res.status(404).json({ message: 'That chat is not open.' });
    await DirectMessage.deleteMany({ chat: chat._id });
    chat.lastText = '';
    chat.lastAt = new Date();
    await chat.save();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const chat = await loadChat(req.params.id, req.user.id);
    if (!chat) return res.status(404).json({ message: 'That chat is not open.' });
    await DirectMessage.deleteMany({ chat: chat._id });
    await chat.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/rings/:id/answer', async (req, res, next) => {
  try {
    const ring = await settleRing(req.params.id, req.user.id, 'to', 'answered');
    if (!ring) return res.status(404).json({ message: 'That call has already ended.' });
    res.json({ ring: presentRing(ring, ring.from) });
  } catch (err) {
    next(err);
  }
});

router.post('/rings/:id/decline', async (req, res, next) => {
  try {
    const ring = await settleRing(req.params.id, req.user.id, 'to', 'declined');
    if (!ring) return res.status(404).json({ message: 'That call has already ended.' });
    res.json({ ring: presentRing(ring, ring.from) });
  } catch (err) {
    next(err);
  }
});

router.post('/rings/:id/cancel', async (req, res, next) => {
  try {
    const ring = await settleRing(req.params.id, req.user.id, 'from', 'cancelled');
    if (!ring) return res.status(404).json({ message: 'That call has already ended.' });
    res.json({ ring: presentRing(ring, ring.from) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/call', async (req, res, next) => {
  try {
    const chat = await loadChat(req.params.id, req.user.id);
    if (!chat) return res.status(404).json({ message: 'That chat is not open.' });
    const other = otherParticipant(chat, req.user.id);
    if (!other || !(await areFriends(req.user.id, other._id))) {
      return res.status(400).json({ message: 'You can only call a friend.' });
    }
    const caller = await User.findById(req.user.id).select('name color personalId avatar');
    const room = await Room.create({
      name: `Call with ${other.name}`.slice(0, 60),
      kind: 'call',
      code: await makeCode(),
      host: req.user.id,
      members: [req.user.id, other._id]
    });
    const ring = await CallRing.create({
      chat: chat._id,
      from: req.user.id,
      to: other._id,
      room: room._id,
      status: 'ringing'
    });
    const payload = presentRing(ring, caller);
    emitToUser(req.user.id, 'call-ring', payload);
    emitToUser(other._id, 'call-ring', payload);
    setTimeout(() => {
      missRing(ring._id).catch((err) => console.error(err));
    }, 45000);
    res.status(201).json({ ring: payload });
  } catch (err) {
    next(err);
  }
});

export default router;
