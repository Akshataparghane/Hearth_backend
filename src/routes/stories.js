import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { Router } from 'express';
import { Friendship } from '../models/Friendship.js';
import { Story } from '../models/Story.js';
import { User } from '../models/User.js';
import { DirectChat } from '../models/DirectChat.js';
import { DirectMessage } from '../models/DirectMessage.js';
import { requireAuth } from '../middleware/auth.js';
import { areFriends } from '../utils/friends.js';
import { publicUser } from '../utils/present.js';
import { emitToUser } from '../socket.js';
import { splitIfLong } from '../utils/splitMedia.js';

const router = Router();
router.use(requireAuth);

const storyColors = new Set(['#b85a28', '#a33b32', '#3f6b3a', '#3d527f', '#7a3d68', '#7a5a08', '#2f6f6a', '#5c463b']);
const storyEmojis = new Set(['❤️', '😂', '😮', '😢', '🔥', '👏']);
const day = 24 * 60 * 60 * 1000;
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
  limits: { fileSize: 250 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    const type = String(file.mimetype || '');
    const ok = /^image\/(jpeg|png|gif|webp)$/.test(type)
      || /^video\/(mp4|webm|ogg|quicktime|3gpp|3gpp2|mpeg|x-m4v)$/.test(type)
      || /^audio\/(mpeg|mp3|mp4|wav|x-wav|ogg|webm|aac|x-m4a|mp4a-latm|x-aac)$/.test(type)
      || (type === '' || type === 'application/octet-stream') && /\.(jpe?g|png|gif|webp|mp4|mov|m4v|webm|3gp|mp3|m4a|wav|aac)$/.test(name);
    if (ok) cb(null, true);
    else cb(new Error('Add a photo, a video, or an audio file.'));
  }
});

function canSeeStory(owner, viewerId) {
  if (!owner) return false;
  if (String(owner._id) === String(viewerId)) return true;
  const privacy = owner.storyPrivacy || 'friends';
  if (privacy === 'only') return false;
  if (privacy === 'selected') return (owner.storyAudience || []).some((id) => String(id) === String(viewerId));
  return true;
}

function presentStory(story, includeViewers) {
  return {
    id: story._id.toString(),
    kind: story.kind,
    media: story.media || '',
    text: story.text || '',
    color: story.color || '#b85a28',
    createdAt: story.createdAt,
    expiresAt: story.expiresAt,
    viewers: includeViewers
      ? (story.viewers || [])
          .filter((view) => view.user)
          .map((view) => ({ ...publicUser(view.user), seenAt: view.seenAt }))
      : undefined,
    reactions: (story.reactions || [])
      .filter((item) => item.emoji)
      .map((item) => ({ emoji: item.emoji, name: item.user?.name || '' }))
  };
}

async function sendStoryChat(ownerId, me, text) {
  const pair = [String(me), String(ownerId)].sort().join(':');
  let chat = await DirectChat.findOne({ pair });
  if (!chat) chat = await DirectChat.create({ pair, participants: [me, ownerId] });
  const doc = await DirectMessage.create({ chat: chat._id, sender: me, kind: 'text', text });
  chat.lastText = text.slice(0, 140);
  chat.lastAt = doc.createdAt;
  await chat.save();
  const populated = await doc.populate('sender', 'name color personalId avatar');
  const message = {
    id: populated._id.toString(),
    chatId: populated.chat.toString(),
    kind: 'text',
    text: populated.text,
    media: '',
    viewOnce: false,
    opened: false,
    read: false,
    createdAt: populated.createdAt,
    sender: publicUser(populated.sender)
  };
  emitToUser(me, 'direct', message);
  emitToUser(ownerId, 'direct', message);
  return message;
}

async function audience(userId) {
  const rows = await Friendship.find({
    status: 'accepted',
    $or: [{ requester: userId }, { recipient: userId }]
  }).select('requester recipient');
  const ids = rows.map((row) => (String(row.requester) === String(userId) ? row.recipient : row.requester));
  ids.push(userId);
  return ids;
}

router.get('/', async (req, res, next) => {
  try {
    const ids = await audience(req.user.id);
    const stories = await Story.find({ user: { $in: ids }, expiresAt: { $gt: new Date() } })
      .sort({ createdAt: 1 })
      .populate('user', 'name color personalId avatar storyPrivacy storyAudience')
      .populate('viewers.user', 'name color personalId avatar')
      .populate('reactions.user', 'name');
    const groups = new Map();
    for (const story of stories) {
      if (!story.user || !canSeeStory(story.user, req.user.id)) continue;
      const key = story.user._id.toString();
      const mine = key === String(req.user.id);
      if (!groups.has(key)) groups.set(key, { user: publicUser(story.user), mine, items: [] });
      groups.get(key).items.push(presentStory(story, mine));
    }
    const list = [...groups.values()].sort((a, b) => Number(b.mine) - Number(a.mine));
    res.json({ stories: list });
  } catch (err) {
    next(err);
  }
});

router.post('/', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message || 'Could not add that story.' });
    try {
      const active = await Story.countDocuments({ user: req.user.id, expiresAt: { $gt: new Date() } });
      if (active >= 10) return res.status(400).json({ message: 'You can add up to 10 stories.' });
      const text = String(req.body.text || '').trim().slice(0, 200);
      const color = storyColors.has(req.body.color) ? req.body.color : '#b85a28';
      let kind = 'text';
      let media = '';
      if (req.file) {
        const name = String(req.file.originalname || '').toLowerCase();
        const type = String(req.file.mimetype || '');
        kind = type.startsWith('video/') || /\.(mp4|mov|m4v|webm|3gp)$/.test(name)
          ? 'video'
          : type.startsWith('audio/') || /\.(mp3|m4a|wav|aac|ogg)$/.test(name)
            ? 'audio'
            : 'image';
        media = `/uploads/${req.file.filename}`;
      } else if (!text) {
        return res.status(400).json({ message: 'Add a photo, a video, or some words.' });
      }
      const room = 10 - active;
      let files = req.file ? [req.file.path] : [];
      if (req.file && (kind === 'video' || kind === 'audio')) {
        files = await splitIfLong(req.file.path, kind, uploadsDir, room);
      }
      if (req.file && !files.length) return res.status(400).json({ message: 'You can add up to 10 stories.' });
      const stories = [];
      if (!files.length) {
        const story = await Story.create({
          user: req.user.id,
          kind,
          media,
          text,
          color,
          expiresAt: new Date(Date.now() + day)
        });
        stories.push(presentStory(story));
      }
      for (const filePath of files) {
        const story = await Story.create({
          user: req.user.id,
          kind,
          media: `/uploads/${path.basename(filePath)}`,
          text,
          color,
          expiresAt: new Date(Date.now() + day)
        });
        stories.push(presentStory(story));
      }
      res.status(201).json({ story: stories[0], stories });
    } catch (error) {
      next(error);
    }
  });
});

router.post('/:id/seen', async (req, res, next) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story || story.expiresAt <= new Date()) return res.status(404).json({ message: 'That story is gone.' });
    if (story.user.equals(req.user.id)) return res.json({ ok: true });
    const owner = await story.populate('user', 'storyPrivacy storyAudience');
    if (!canSeeStory(owner.user, req.user.id)) return res.status(404).json({ message: 'That story is gone.' });
    const already = story.viewers.some((view) => view.user && view.user.equals(req.user.id));
    if (!already) {
      story.viewers.push({ user: req.user.id, seenAt: new Date() });
      await story.save();
      const watcher = await User.findById(req.user.id).select('name color personalId avatar');
      emitToUser(owner.user._id, 'story-seen', {
        storyId: story._id.toString(),
        viewer: { ...publicUser(watcher), seenAt: new Date() }
      });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/reply', async (req, res, next) => {
  try {
    const text = String(req.body.text || '').trim().slice(0, 300);
    if (!text) return res.status(400).json({ message: 'Write a reply first.' });
    const story = await Story.findById(req.params.id).populate('user', 'name storyPrivacy storyAudience');
    if (!story || story.expiresAt <= new Date() || !canSeeStory(story.user, req.user.id)) {
      return res.status(404).json({ message: 'That story is gone.' });
    }
    if (story.user._id.equals(req.user.id)) return res.status(400).json({ message: 'This is your story.' });
    if (!(await areFriends(req.user.id, story.user._id))) {
      return res.status(400).json({ message: 'You can only reply to a friend.' });
    }
    const message = await sendStoryChat(story.user._id, req.user.id, `Reply to your story: ${text}`.slice(0, 500));
    res.status(201).json({ message });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/react', async (req, res, next) => {
  try {
    const emoji = String(req.body.emoji || '');
    if (!storyEmojis.has(emoji)) return res.status(400).json({ message: 'Pick one of the reactions.' });
    const story = await Story.findById(req.params.id).populate('user', 'name storyPrivacy storyAudience');
    if (!story || story.expiresAt <= new Date() || !canSeeStory(story.user, req.user.id)) {
      return res.status(404).json({ message: 'That story is gone.' });
    }
    if (story.user._id.equals(req.user.id)) return res.status(400).json({ message: 'This is your story.' });
    if (!(await areFriends(req.user.id, story.user._id))) {
      return res.status(400).json({ message: 'You can only react to a friend.' });
    }
    story.reactions = (story.reactions || []).filter((item) => item.user && !item.user.equals(req.user.id));
    story.reactions.push({ user: req.user.id, emoji });
    if (story.reactions.length > 40) story.reactions = story.reactions.slice(-40);
    await story.save();
    await sendStoryChat(story.user._id, req.user.id, `${emoji} on your story`);
    res.json({ ok: true, emoji });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story || !story.user.equals(req.user.id)) return res.status(404).json({ message: 'That story is gone.' });
    await story.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
