export async function sendMail({ to, subject, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || 'Hearth <onboarding@resend.dev>',
      to: [to],
      subject,
      text
    })
  });

  if (response.ok) return true;
  const data = await response.json().catch(() => ({}));
  const message = data.message || data.error || 'Resend could not send the email.';
  throw new Error(typeof message === 'string' ? message : 'Resend could not send the email.');
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
