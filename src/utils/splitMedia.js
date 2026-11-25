import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static');

function ffmpeg(args) {
  return new Promise((resolve) => {
    if (!ffmpegPath) {
      resolve({ code: 1, err: '' });
      return;
    }
    const child = spawn(ffmpegPath, ['-hide_banner', ...args], { windowsHide: true });
    let err = '';
    child.stderr.on('data', (chunk) => {
      err += chunk.toString();
    });
    child.on('error', () => resolve({ code: 1, err }));
    child.on('close', (code) => resolve({ code: code ?? 1, err }));
  });
}

function secondsOf(log) {
  const match = String(log || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function moveFile(from, to) {
  try {
    fs.renameSync(from, to);
  } catch {
    fs.copyFileSync(from, to);
    fs.unlinkSync(from);
  }
}

export async function splitIfLong(filePath, kind, uploadsDir, maxParts) {
  if (maxParts < 1) return [];
  const probed = await ffmpeg(['-i', filePath]);
  const seconds = secondsOf(probed.err);
  const ext = kind === 'audio' ? '.m4a' : '.mp4';
  if (!seconds || seconds <= 60) return [filePath];
  if (maxParts === 1) {
    const dest = path.join(uploadsDir, `${crypto.randomBytes(16).toString('hex')}${ext}`);
    const args = kind === 'audio'
      ? ['-y', '-i', filePath, '-t', '60', '-vn', '-c:a', 'aac', '-b:a', '96k', dest]
      : ['-y', '-i', filePath, '-t', '60', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-c:a', 'aac', '-b:a', '96k', dest];
    const trimmed = await ffmpeg(args);
    if (trimmed.code !== 0) return [filePath];
    fs.unlinkSync(filePath);
    return [dest];
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-story-'));
  const pattern = path.join(dir, `part-%03d${ext}`);
  const copy = await ffmpeg(['-y', '-i', filePath, '-c', 'copy', '-f', 'segment', '-segment_time', '60', '-reset_timestamps', '1', pattern]);
  let names = fs.readdirSync(dir).filter((name) => name.startsWith('part-')).sort();
  if (copy.code !== 0 || names.length < 2) {
    for (const name of names) fs.unlinkSync(path.join(dir, name));
    const encode = kind === 'audio'
      ? ['-y', '-i', filePath, '-vn', '-c:a', 'aac', '-b:a', '96k', '-f', 'segment', '-segment_time', '60', '-reset_timestamps', '1', pattern]
      : ['-y', '-i', filePath, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-f', 'segment', '-segment_time', '60', '-reset_timestamps', '1', pattern];
    await ffmpeg(encode);
    names = fs.readdirSync(dir).filter((name) => name.startsWith('part-')).sort();
  }
  if (names.length < 2) {
    fs.rmSync(dir, { recursive: true, force: true });
    return [filePath];
  }
  const kept = names.slice(0, maxParts);
  for (const name of names.slice(maxParts)) fs.unlinkSync(path.join(dir, name));
  const moved = kept.map((name) => {
    const dest = path.join(uploadsDir, `${crypto.randomBytes(16).toString('hex')}${ext}`);
    moveFile(path.join(dir, name), dest);
    return dest;
  });
  fs.rmSync(dir, { recursive: true, force: true });
  fs.unlinkSync(filePath);
  return moved;
}
