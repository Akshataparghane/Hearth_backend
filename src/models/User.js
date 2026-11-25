import mongoose from 'mongoose';

const palette = ['#9a4318', '#a33b32', '#3f6b3a', '#3d527f', '#7a3d68', '#7a5a08'];

function colorFromName(name) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 40 },
    personalId: { type: String, required: true, unique: true, lowercase: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, unique: true, sparse: true, trim: true },
    password: { type: String, required: true, select: false },
    color: { type: String, required: true },
    gender: { type: String, enum: ['male', 'female', 'other', ''], default: '' },
    avatar: { type: String, default: '' },
    chatColor: { type: String, default: '#b85a28' },
    chatWallpaper: { type: String, default: 'cream' },
    theme: { type: String, enum: ['bright', 'dark'], default: 'bright' },
    storyPrivacy: { type: String, enum: ['friends', 'only', 'selected'], default: 'friends' },
    storyAudience: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    resetCodeHash: { type: String, default: '', select: false },
    resetCodeExpires: { type: Date, select: false },
    resetAttempts: { type: Number, default: 0, select: false }
  },
  { timestamps: true }
);

userSchema.pre('validate', function setColor(next) {
  if (!this.color && this.name) this.color = colorFromName(this.name);
  next();
});

export const User = mongoose.model('User', userSchema);
