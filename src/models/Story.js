import mongoose from 'mongoose';

const storySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['image', 'video', 'audio', 'text'], required: true },
    media: { type: String, default: '' },
    text: { type: String, default: '', maxlength: 200 },
    color: { type: String, default: '#b85a28' },
    expiresAt: { type: Date, required: true },
    viewers: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        seenAt: { type: Date, default: Date.now }
      }
    ],
    reactions: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        emoji: { type: String, maxlength: 8 }
      }
    ]
  },
  { timestamps: true }
);

storySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
storySchema.index({ user: 1, expiresAt: 1 });

export const Story = mongoose.model('Story', storySchema);
