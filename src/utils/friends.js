import { Friendship } from '../models/Friendship.js';

export async function areFriends(a, b) {
  if (!a || !b || String(a) === String(b)) return false;
  const rel = await Friendship.findOne({
    status: 'accepted',
    $or: [
      { requester: a, recipient: b },
      { requester: b, recipient: a }
    ]
  });
  return Boolean(rel);
}
