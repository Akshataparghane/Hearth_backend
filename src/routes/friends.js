import { Router } from 'express';
import { User } from '../models/User.js';
import { Friendship } from '../models/Friendship.js';
import { requireAuth } from '../middleware/auth.js';
import { publicUser } from '../utils/present.js';
import { emitToUser } from '../socket.js';

function personLabel(user) {
  return user?.personalId ? `${user.name} (@${user.personalId})` : user?.name || 'Someone';
}

const router = Router();
router.use(requireAuth);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.get('/', async (req, res, next) => {
  try {
    const me = req.user.id;
    const rels = await Friendship.find({
      $or: [{ requester: me }, { recipient: me }]
    }).populate('requester recipient', 'name color personalId avatar');

    const friends = [];
    const incoming = [];
    const outgoing = [];

    for (const rel of rels) {
      if (!rel.requester || !rel.recipient) continue;
      const iAmRequester = rel.requester._id.equals(me);
      const other = publicUser(iAmRequester ? rel.recipient : rel.requester);
      if (rel.status === 'accepted') friends.push(other);
      else if (iAmRequester) outgoing.push({ id: rel._id.toString(), user: other });
      else incoming.push({ id: rel._id.toString(), user: other });
    }

    friends.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ friends, incoming, outgoing });
  } catch (err) {
    next(err);
  }
});

router.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().replace(/^@/, '');
    if (q.length < 2) return res.json({ results: [] });

    const me = req.user.id;
    const pattern = new RegExp(escapeRegex(q.slice(0, 40)), 'i');
    const users = await User.find({
      _id: { $ne: me },
      $or: [{ name: pattern }, { personalId: pattern }, { email: pattern }]
    })
      .limit(8)
      .select('name color personalId avatar');

    const ids = users.map((user) => user._id);
    const rels = await Friendship.find({
      $or: [
        { requester: me, recipient: { $in: ids } },
        { recipient: me, requester: { $in: ids } }
      ]
    });

    const results = users.map((user) => {
      const rel = rels.find(
        (item) => item.requester.equals(user._id) || item.recipient.equals(user._id)
      );
      let relation = 'none';
      if (rel?.status === 'accepted') relation = 'friends';
      else if (rel && rel.requester.equals(me)) relation = 'outgoing';
      else if (rel) relation = 'incoming';
      return { ...publicUser(user), relation, requestId: rel ? rel._id.toString() : null };
    });

    res.json({ results });
  } catch (err) {
    next(err);
  }
});

router.post('/requests', async (req, res, next) => {
  try {
    const me = req.user.id;
    const userId = String(req.body.userId || '');
    if (!userId || userId === me) {
      return res.status(400).json({ message: 'Choose someone else.' });
    }

    const person = await User.findById(userId).select('name');
    if (!person) return res.status(404).json({ message: 'No one by that name is here.' });

    const reverse = await Friendship.findOne({ requester: userId, recipient: me });
    if (reverse?.status === 'accepted') {
      return res.status(409).json({ message: 'You are already friends.' });
    }
    if (reverse?.status === 'pending') {
      reverse.status = 'accepted';
      await reverse.save();
      emitToUser(userId, 'notice', {
        text: `${personLabel(req.user)} accepted your friend request.`
      });
      return res.json({ status: 'accepted' });
    }

    const existing = await Friendship.findOne({ requester: me, recipient: userId });
    if (existing?.status === 'accepted') {
      return res.status(409).json({ message: 'You are already friends.' });
    }
    if (existing?.status === 'pending') {
      return res.status(409).json({ message: 'Request already sent.' });
    }

    await Friendship.create({ requester: me, recipient: userId, status: 'pending' });
    emitToUser(userId, 'notice', {
      text: `${personLabel(req.user)} sent you a friend request.`
    });
    res.status(201).json({ status: 'pending' });
  } catch (err) {
    next(err);
  }
});

router.post('/requests/:id/accept', async (req, res, next) => {
  try {
    const rel = await Friendship.findById(req.params.id);
    if (!rel || !rel.recipient.equals(req.user.id) || rel.status !== 'pending') {
      return res.status(404).json({ message: 'That request is gone.' });
    }
    rel.status = 'accepted';
    await rel.save();
    emitToUser(rel.requester, 'notice', {
      text: `${personLabel(req.user)} accepted your friend request.`
    });
    res.json({ status: 'accepted' });
  } catch (err) {
    next(err);
  }
});

router.delete('/requests/:id', async (req, res, next) => {
  try {
    const rel = await Friendship.findById(req.params.id);
    if (!rel) return res.status(404).json({ message: 'That request is gone.' });
    const mine = rel.requester.equals(req.user.id) || rel.recipient.equals(req.user.id);
    if (!mine || rel.status !== 'pending') {
      return res.status(404).json({ message: 'That request is gone.' });
    }
    await rel.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
