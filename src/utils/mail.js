import nodemailer from 'nodemailer';

export async function sendMail({ to, subject, text }) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return false;

  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass }
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || user,
    to,
    subject,
    text
  });
  return true;
}

export function sendResetCode(email, code) {
  return sendMail({
    to: email,
    subject: 'Your Hearth password code',
    text: `Your password code is ${code}. It expires in 10 minutes.`
  });
}

export function sendSignupCode(email, code) {
  return sendMail({
    to: email,
    subject: 'Your Hearth verification code',
    text: `Your account code is ${code}. It expires in 10 minutes.`
  });
}
