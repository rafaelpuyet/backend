const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendEmail({ to, subject, template, data }) {
  const html = renderTemplate(template, data);
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to,
    subject,
    html,
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await transporter.sendMail(mailOptions);
      return true;
    } catch (err) {
      console.error(`Email attempt ${attempt} failed: ${err}`);
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  throw new Error('Failed to send email after 3 attempts');
}

function renderTemplate(template, data) {
  switch (template) {
    case 'verification':
      return `
        <h1>Verifica tu correo</h1>
        <p>Haz clic <a href="${process.env.FRONTEND_URL}/verify-email?token=${data.token}">aquí</a> para verificar tu correo.</p>
        <p>Expira en 30 minutos.</p>
      `;
    case 'confirmation':
      return `
        <h1>Confirmación de Cita</h1>
        <p>Tu cita con ${data.businessName} el ${data.date} a las ${data.time} está reservada.</p>
        <p>Gestiona tu cita aquí: <a href="${process.env.FRONTEND_URL}/appointments/${data.appointmentId}/manage?token=${data.token}">Gestionar Cita</a></p>
      `;
    case 'reminder':
      return `
        <h1>Recordatorio de Cita</h1>
        <p>Tienes una cita con ${data.businessName} el ${data.date} a las ${data.time}.</p>
      `;
    case 'cancellation':
      return `
        <h1>Cita Cancelada</h1>
        <p>Tu cita con ${data.businessName} el ${data.date} a las ${data.time} ha sido cancelada.</p>
      `;
    default:
      return '';
  }
}

module.exports = { sendEmail };