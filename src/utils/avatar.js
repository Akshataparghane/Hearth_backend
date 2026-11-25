export const portraitIds = new Set(['mira', 'hana', 'lina', 'ken', 'rio', 'nori', 'sol', 'aoki']);

export function cleanAvatar(value) {
  const avatar = String(value || '');
  if (!avatar) return '';
  if (portraitIds.has(avatar)) return avatar;
  if (/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(avatar) && avatar.length <= 120000) return avatar;
  return null;
}

export function cleanGender(value) {
  const gender = String(value || '');
  if (gender === 'male' || gender === 'female' || gender === 'other') return gender;
  return '';
}
