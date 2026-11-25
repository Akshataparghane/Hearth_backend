import mongoose from 'mongoose';

const directMessageSchema = new mongoose.Schema(
  {
    chat: { type: mongoose.Schema.Types.ObjectId, ref: 'DirectChat', required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['text', 'image', 'video', 'sticker'], default: 'text' },
    text: { type: String, default: '', maxlength: 500 },
    media: { type: String, default: '' },
    viewOnce: { type: Boolean, default: false },
    openedAt: { type: Date },
    readAt: { type: Date, default: null },
    forwarded: { type: Boolean, default: false },
    reply: {
      id: { type: String, default: '' },
      name: { type: String, default: '' },
      kind: { type: String, default: '' },
      text: { type: String, default: '' }
    }
  },
  { timestamps: true }
);

export const DirectMessage = mongoose.model('DirectMessage', directMessageSchema);
