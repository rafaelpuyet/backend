const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.ethereal.email',
  port: 587,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const sendEmail = async (to, subject, html, retries = 3, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      await transporter.sendMail({ to, subject, html });
      return;
    } catch (error) {
      if (i === retries - 1) throw new Error(`Failed to send email after ${retries} attempts: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, delay * Math.pow(5, i)));
    }
  }
};

const sendVerificationEmail = async (email, token) => {
  try {
    const encodedToken = encodeURIComponent(token); // Ensure URL-safe token
    const url = `${process.env.FRONTEND_URL}/verify?token=${encodedToken}`;
    console.log(`Sending verification email to ${email} with link: ${url}`); // Debug log
    const html = `
      <h2>Verifica tu cuenta</h2>
      <p>Por favor, verifica tu correo electrónico haciendo clic en el siguiente enlace:</p>
      <a href="${url}">Verificar cuenta</a>
      <p>Este enlace expira en 30 minutos.</p>
    `;
    await sendEmail(email, 'Verifica tu cuenta - MiAgenda', html);
  } catch (error) {
    throw new Error(`Failed to send verification email: ${error.message}`);
  }
};

const sendConfirmationEmail = async (email, appointmentId, token) => {
  const encodedToken = encodeURIComponent(token);
  const url = `${process.env.FRONTEND_URL}/appointments/${appointmentId}?token=${encodedToken}`;
  console.log(`Sending confirmation email to ${email} with link: ${url}`); // Debug log
  const html = `
    <h2>Confirmación de cita</h2>
    <p>Tu cita ha sido creada exitosamente. Puedes gestionarla aquí:</p>
    <a href="${url}">Gestionar cita</a>
    <p>Este enlace expira en 10 minutos.</p>
  `;
  await sendEmail(email, 'Confirmación de cita - MiAgenda', html);
};

const sendReminderEmail = async (email, appointment) => {
  const html = `
    <h2>Recordatorio de cita</h2>
    <p>Tienes una cita programada para el ${new Date(appointment.startTime).toLocaleString()}.</p>
    <p>Detalles: ${appointment.clientName}, ${appointment.clientPhone}</p>
  `;
  await sendEmail(email, 'Recordatorio de cita - MiAgenda', html);
};

const sendCancellationEmail = async (email, appointmentId) => {
  const html = `
    <h2>Cita cancelada</h2>
    <p>La cita con ID ${appointmentId} ha sido cancelada.</p>
  `;
  await sendEmail(email, 'Cita cancelada - MiAgenda', html);
};

module.exports = { sendVerificationEmail, sendConfirmationEmail, sendReminderEmail, sendCancellationEmail };