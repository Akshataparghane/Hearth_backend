import mongoose from 'mongoose';

const signupCodeSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    codeHash: { type: String, required: true },
    expires: { type: Date, required: true }
  },
  { timestamps: true }
);

signupCodeSchema.index({ expires: 1 }, { expireAfterSeconds: 0 });

export const SignupCode = mongoose.model('SignupCode', signupCodeSchema);
