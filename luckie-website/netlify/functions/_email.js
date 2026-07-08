// Shared email helper — sends mail via the owner's own Gmail account (SMTP + App Password).
// Keeps everything "first party": no third-party email service involved.
const nodemailer = require('nodemailer');

const GMAIL_USER = 'nikdastardlyarea52@gmail.com';

let transporter;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }
  return transporter;
}

async function sendMail({ to, subject, html, text }) {
  const t = getTransporter();
  return t.sendMail({
    from: `Luckie 🐾 <${GMAIL_USER}>`,
    to,
    subject,
    html,
    text: text || (html ? html.replace(/<[^>]+>/g, ' ') : ''),
  });
}

module.exports = { sendMail, GMAIL_USER };
