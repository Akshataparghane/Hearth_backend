import mongoose from 'mongoose';

const roomSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    kind: { type: String, enum: ['friends', 'couple', 'family', 'call'], required: true },
    code: { type: String, required: true, unique: true },
    host: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    media: {
      kind: { type: String, enum: ['none', 'youtube', 'file', 'link'], default: 'none' },
      url: { type: String, default: '' },
      youtubeId: { type: String, default: '' }
    },
    playback: {
      playing: { type: Boolean, default: false },
      position: { type: Number, default: 0 },
      updatedAt: { type: Date, default: Date.now }
    }
  },
  { timestamps: true }
);

export const Room = mongoose.model('Room', roomSchema);
