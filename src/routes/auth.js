import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { User } from '../models/User.js';
import { SignupCode } from '../models/SignupCode.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { accountUser } from '../utils/present.js';
import { sendResetCode, sendSignupCode } from '../utils/mail.js';
import { cleanAvatar, cleanGender } from '../utils/avatar.js';

const router = Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^\d{10,15}$/.test(digits) ? digits : '';
}

async function accountClash(email, phone) {
  const [byEmail, byPhone] = await Promise.all([
    User.findOne({ email }).select('_id'),
    phone ? User.findOne({ phone }).select('_id') : null
  ]);
  if (byEmail && byPhone) return { status: 409, message: 'User already exist' };
  if (byEmail) return { status: 409, message: 'An account with that email already exists.' };
  if (byPhone) return { status: 409, message: 'An account with that mobile number already exists.' };
  return null;
}
const personalIdPattern = /^[a-z0-9_]{3,20}$/;
const chatColors = new Set(['#b85a28', '#a33b32', '#3f6b3a', '#3d527f', '#7a3d68', '#7a5a08', '#2f6f6a', '#5c463b']);
const wallpapers = new Set(['cream', 'blush', 'sage', 'night', 'ink', 'paper']);
const uploadsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
const wallpaperUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase().slice(0, 8) || '.jpg';
      cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Use a jpg, png, or webp photo for the wallpaper.'));
  }
});

router.post('/signup-code', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!emailPattern.test(email)) return res.status(400).json({ message: 'Enter a valid email.' });
    const existing = await User.findOne({ email }).select('_id');
    if (existing) return res.status(409).json({ message: 'An account with that email already exists.' });

    const code = String(crypto.randomInt(100000, 1000000));
    let sent = false;
    try {
      sent = await sendSignupCode(email, code);
    } catch (err) {
      console.error('Could not send the signup code.', err.message);
      return res.status(503).json({ message: 'The code could not be sent. Try again in a moment.' });
    }
    if (!sent) return res.status(503).json({ message: 'Email is not set up on this server yet.' });

    await SignupCode.findOneAndUpdate(
      { email },
      { codeHash: await bcrypt.hash(code, 8), expires: new Date(Date.now() + 10 * 60 * 1000) },
      { upsert: true, new: true }
    );
    res.json({ sent: true, message: 'We sent a 6-digit code to that email.' });
  } catch (err) {
    next(err);
  }
});

router.post('/signup', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const personalId = String(req.body.personalId || '').trim().toLowerCase().replace(/^@/, '');
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = cleanPhone(req.body.phone);
    const code = String(req.body.code || '').trim();
    const password = String(req.body.password || '');
    const gender = cleanGender(req.body.gender);
    const avatar = cleanAvatar(req.body.avatar);

    if (name.length < 2 || name.length > 40) {
      return res.status(400).json({ message: 'Name should be 2 to 40 characters.' });
    }
    if (!personalIdPattern.test(personalId)) {
      return res.status(400).json({ message: 'Personal ID must be 3–20 letters, numbers, or underscores.' });
    }
    if (!emailPattern.test(email)) {
      return res.status(400).json({ message: 'Enter a valid email.' });
    }
    if (!phone) return res.status(400).json({ message: 'Enter a valid mobile number.' });
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ message: 'Enter the 6-digit code from your email.' });
    if (password.length < 6 || password.length > 100) {
      return res.status(400).json({ message: 'Password should be at least 6 characters.' });
    }
    if (!gender) return res.status(400).json({ message: 'Choose male, female, or other.' });
    if (!avatar) return res.status(400).json({ message: 'Choose a profile picture.' });

    const clash = await accountClash(email, phone);
    if (clash) return res.status(clash.status).json({ message: clash.message });
    const pending = await SignupCode.findOne({ email });
    if (!pending || pending.expires.getTime() < Date.now()) {
      return res.status(400).json({ message: 'Send a new code to your email first.' });
    }
    if (!(await bcrypt.compare(code, pending.codeHash))) {
      return res.status(400).json({ message: 'That code is not correct.' });
    }
    const takenId = await User.findOne({ personalId });
    if (takenId) {
      return res.status(409).json({ message: 'That personal ID is already taken.' });
    }

    const user = await User.create({
      name,
      personalId,
      email,
      phone,
      gender,
      avatar: avatar || '',
      password: await bcrypt.hash(password, 10)
    });
    await SignupCode.deleteOne({ email });
    res.status(201).json({ token: signToken(user), user: accountUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const identifier = String(req.body.email || '').trim().toLowerCase().replace(/^@/, '');
    const password = String(req.body.password || '');
    const user = await User.findOne({
      $or: [{ email: identifier }, { personalId: identifier }]
    }).select('+password');
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({
        message: 'No account matches that email, personal ID, and password.'
      });
    }
    res.json({ token: signToken(user), user: accountUser(user) });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ message: 'Please sign in.' });
    res.json({ user: accountUser(user) });
  } catch (err) {
    next(err);
  }
});

router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const personalId = String(req.body.personalId || '').trim().toLowerCase().replace(/^@/, '');
    const email = String(req.body.email || '').trim().toLowerCase();
    const gender = cleanGender(req.body.gender);
    const avatar = cleanAvatar(req.body.avatar);

    if (name.length < 2 || name.length > 40) {
      return res.status(400).json({ message: 'Name should be 2 to 40 characters.' });
    }
    if (!personalIdPattern.test(personalId)) {
      return res.status(400).json({ message: 'User ID must be 3–20 letters, numbers, or underscores.' });
    }
    if (!emailPattern.test(email)) {
      return res.status(400).json({ message: 'Enter a valid email.' });
    }
    if (req.body.gender && !gender) return res.status(400).json({ message: 'Choose male, female, or other.' });
    if (avatar === null) return res.status(400).json({ message: 'Choose a picture from the list, or a smaller photo.' });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ message: 'Please sign in.' });

    const emailTaken = await User.findOne({ email, _id: { $ne: user._id } });
    if (emailTaken) return res.status(409).json({ message: 'An account with that email already exists.' });
    const idTaken = await User.findOne({ personalId, _id: { $ne: user._id } });
    if (idTaken) return res.status(409).json({ message: 'That user ID is already taken.' });

    user.name = name;
    user.personalId = personalId;
    user.email = email;
    if ('gender' in req.body && gender) user.gender = gender;
    if ('avatar' in req.body && avatar !== null) user.avatar = avatar;
    await user.save();
    res.json({ token: signToken(user), user: accountUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/forgot', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!emailPattern.test(email)) {
      return res.status(400).json({ message: 'Enter the email on your account.' });
    }
    const user = await User.findOne({ email }).select('+resetCodeHash +resetAttempts');
    if (!user) return res.status(404).json({ message: 'Wrong email' });

    const code = String(crypto.randomInt(100000, 1000000));
    let sent = false;
    try {
      sent = await sendResetCode(email, code);
    } catch (err) {
      console.error('Could not send the password code.', err.message);
      return res.status(503).json({ message: 'The code could not be sent. Try again in a moment.' });
    }
    if (!sent) {
      return res.status(503).json({ message: 'Password email is not set up on this server yet.' });
    }

    user.resetCodeHash = await bcrypt.hash(code, 8);
    user.resetCodeExpires = new Date(Date.now() + 10 * 60 * 1000);
    user.resetAttempts = 0;
    await user.save();

    res.json({
      sent: true,
      message: 'We sent a 6-digit code to that email. It expires in 10 minutes.'
    });
  } catch (err) {
    next(err);
  }
});

router.post('/reset', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    const password = String(req.body.password || '');
    if (!emailPattern.test(email)) {
      return res.status(400).json({ message: 'Enter the email on your account.' });
    }
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ message: 'Enter the 6-digit code.' });
    }
    if (password.length < 6 || password.length > 100) {
      return res.status(400).json({ message: 'New password should be at least 6 characters.' });
    }

    const user = await User.findOne({ email }).select('+password +resetCodeHash +resetCodeExpires +resetAttempts');
    if (!user || !user.resetCodeHash || !user.resetCodeExpires) {
      return res.status(400).json({ message: 'Send a new code first.' });
    }
    if (user.resetCodeExpires.getTime() < Date.now()) {
      return res.status(400).json({ message: 'That code expired. Send a new one.' });
    }
    const matches = await bcrypt.compare(code, user.resetCodeHash);
    if (!matches) {
      user.resetAttempts = (user.resetAttempts || 0) + 1;
      if (user.resetAttempts >= 5) {
        user.resetCodeHash = '';
        user.resetCodeExpires = undefined;
      }
      await user.save();
      return res.status(400).json({ message: 'That code is not correct.' });
    }

    user.password = await bcrypt.hash(password, 10);
    user.resetCodeHash = '';
    user.resetCodeExpires = undefined;
    user.resetAttempts = 0;
    await user.save();
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    next(err);
  }
});

router.post('/style', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ message: 'Please sign in.' });
    const chatColor = String(req.body.chatColor || '');
    const chatWallpaper = String(req.body.chatWallpaper || '');
    if (chatColors.has(chatColor)) user.chatColor = chatColor;
    if (wallpapers.has(chatWallpaper) || chatWallpaper.startsWith('/uploads/')) user.chatWallpaper = chatWallpaper;
    const theme = String(req.body.theme || '');
    if (theme === 'bright' || theme === 'dark') user.theme = theme;
    const privacy = String(req.body.storyPrivacy || '');
    if (privacy === 'friends' || privacy === 'only' || privacy === 'selected') user.storyPrivacy = privacy;
    if (Array.isArray(req.body.storyAudience)) {
      user.storyAudience = req.body.storyAudience.map(String).filter((id) => /^[a-f0-9]{24}$/i.test(id)).slice(0, 80);
    }
    await user.save();
    res.json({ user: accountUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/wallpaper', requireAuth, (req, res, next) => {
  wallpaperUpload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message || 'Could not use that photo.' });
    try {
      if (!req.file) return res.status(400).json({ message: 'Choose a photo for the wallpaper.' });
      const user = await User.findById(req.user.id);
      if (!user) return res.status(401).json({ message: 'Please sign in.' });
      user.chatWallpaper = `/uploads/${req.file.filename}`;
      await user.save();
      res.json({ user: accountUser(user) });
    } catch (error) {
      next(error);
    }
  });
});

export default router;
