import nodemailer from "nodemailer";

/**
 * SMS adapter stand-in. In production this posts to a national SMS gateway
 * aggregator (e.g. Africa's Talking) that fans out across MNOs. Kept as a
 * logged mock here so the pilot runs without a paid SMS account -- the
 * NotificationLog row is the durable record of "what would have been sent".
 */
export async function sendSms(toPhone: string, body: string): Promise<{ providerRef: string }> {
  console.log(`[sms:mock] to=${toPhone} :: ${body}`);
  return { providerRef: `mock-sms-${Date.now()}` };
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? "mailhog",
  port: Number(process.env.SMTP_PORT ?? 1025),
  secure: false,
});

export async function sendEmail(toEmail: string, subject: string, body: string): Promise<{ providerRef: string }> {
  const info = await transporter.sendMail({
    from: "noreply@onegov.gov.mw",
    to: toEmail,
    subject,
    text: body,
  });
  return { providerRef: info.messageId };
}
