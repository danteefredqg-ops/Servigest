const sgMail = require('@sendgrid/mail');

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const FROM = process.env.SENDGRID_FROM || 'noreply@servigest.mx';

async function sendPasswordReset(to, nombre, resetUrl) {
  if (!process.env.SENDGRID_API_KEY) {
    console.log(`[RESET-PASSWORD] Sin SENDGRID_API_KEY — email no enviado`);
    console.log(`[RESET-PASSWORD] Usuario: ${nombre} <${to}>`);
    console.log(`[RESET-PASSWORD] URL (válida 1 hora): ${resetUrl}`);
    return;
  }

  await sgMail.send({
    to,
    from: FROM,
    subject: 'Recuperar contraseña — ServiGest',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:24px">
        <h2 style="color:#1a1a2e;margin-bottom:8px">Recuperar contraseña</h2>
        <p style="color:#444">Hola <strong>${nombre}</strong>,</p>
        <p style="color:#444">Recibimos una solicitud para restablecer tu contraseña en <strong>ServiGest</strong>.</p>
        <p style="margin:28px 0">
          <a href="${resetUrl}"
             style="background:#6c47ff;color:#fff;padding:13px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">
            Restablecer contraseña
          </a>
        </p>
        <p style="color:#888;font-size:13px">Este enlace es válido por <strong>1 hora</strong>.<br>Si no solicitaste el cambio, ignora este mensaje.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:28px 0"/>
        <p style="color:#bbb;font-size:11px">ServiGest · Sistema de gestión operacional para talleres y PyMEs</p>
      </div>
    `,
  });
}

module.exports = { sendPasswordReset };
