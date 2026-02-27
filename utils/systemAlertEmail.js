const { createTransporter } = require('./passwordReset');

const getAlertRecipients = () => {
  const { SUPER_ADMIN_ALERT_EMAIL, ALERT_EMAILS } = process.env;

  if (ALERT_EMAILS) {
    return ALERT_EMAILS.split(',').map((email) => email.trim()).filter(Boolean);
  }

  if (SUPER_ADMIN_ALERT_EMAIL) {
    return SUPER_ADMIN_ALERT_EMAIL.split(',').map((email) => email.trim()).filter(Boolean);
  }

  return [];
};

const sendSystemAlertEmail = async ({ subject, text, html }) => {
  const recipients = getAlertRecipients();

  if (!recipients.length) {
    throw new Error('No alert recipients configured. Set ALERT_EMAILS or SUPER_ADMIN_ALERT_EMAIL.');
  }

  const transporter = createTransporter();
  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER;

  await transporter.sendMail({
    from: fromAddress,
    to: recipients,
    subject,
    text,
    html,
  });
};

module.exports = {
  sendSystemAlertEmail,
};


