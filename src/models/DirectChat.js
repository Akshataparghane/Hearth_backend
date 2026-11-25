import mongoose from 'mongoose';

const directChatSchema = new mongoose.Schema(
  {
    pair: { type: String, required: true, unique: true },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
    lastText: { type: String, default: '' },
    lastAt: { type: Date, default: Date.now },
    archivedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    aliases: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        name: { type: String, maxlength: 40 }
      }
    ]
  },
  { timestamps: true }
);

export const DirectChat = mongoose.model('DirectChat', directChatSchema);
