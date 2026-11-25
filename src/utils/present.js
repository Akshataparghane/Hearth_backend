export function publicUser(user) {
  if (!user) return { id: '', name: 'Someone', color: '#b7ab9c' };
  const id = user._id ? user._id.toString() : String(user.id || user);
  return {
    id,
    name: user.name || 'Member',
    personalId: user.personalId || '',
    color: user.color || '#e8a15a',
    avatar: user.avatar || '',
    gender: user.gender || ''
  };
}

export function accountUser(user) {
  return {
    ...publicUser(user),
    email: user.email || '',
    phone: user.phone || '',
    chatColor: user.chatColor || '#b85a28',
    chatWallpaper: user.chatWallpaper || 'cream',
    theme: user.theme === 'dark' ? 'dark' : 'bright',
    storyPrivacy: user.storyPrivacy || 'friends',
    storyAudience: (user.storyAudience || []).map((id) => id.toString())
  };
}

export function presentMessage(message) {
  return {
    id: message._id.toString(),
    text: message.text,
    createdAt: message.createdAt,
    sender: publicUser(message.sender)
  };
}

export function presentRoom(room, messages) {
  return {
    id: room._id.toString(),
    name: room.name,
    kind: room.kind,
    code: room.code,
    hostId: room.host.toString(),
    members: (room.members || []).map(publicUser),
    media: {
      kind: room.media?.kind || 'none',
      url: room.media?.url || '',
      youtubeId: room.media?.youtubeId || ''
    },
    playback: {
      playing: Boolean(room.playback?.playing),
      position: room.playback?.position || 0,
      updatedAt: room.playback?.updatedAt || room.updatedAt
    },
    updatedAt: room.updatedAt,
    ...(messages ? { messages: messages.map(presentMessage) } : {})
  };
}
