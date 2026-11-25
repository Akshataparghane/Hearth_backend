import mongoose from 'mongoose';

const callRingSchema = new mongoose.Schema(
  {
    chat: { type: mongoose.Schema.Types.ObjectId, ref: 'DirectChat', required: true },
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
    status: { type: String, enum: ['ringing', 'answered', 'declined', 'cancelled', 'missed'], default: 'ringing' }
  },
  { timestamps: true }
);

export const CallRing = mongoose.model('CallRing', callRingSchema);
