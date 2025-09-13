import express from "express";
import nodemailer from "nodemailer";

const router = express.Router();

router.post("/", async (req, res) => {
  const { lastname, firstname, email, message } = req.body;

  // Configure le transport SMTP
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com", // SMTP de ton provider
    port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 465, // 465 pour SSL
    secure: true, // true pour 465, false pour 587
    auth: {
      user: process.env.RECEIVER_EMAIL,
      pass: process.env.SMTP_PASS,
    },
  });

  try {
    await transporter.sendMail({
      from: `"${firstname} ${lastname}" <${email}>`, // expéditeur
      to: process.env.RECEIVER_EMAIL, // email de destination
      subject: `Nouveau message de ${firstname} ${lastname}`,
      text: message,
      html: `<p>${message}</p><p>De : ${firstname} ${lastname} (${email})</p>`,
    });

    res.json({ success: true, message: "Email envoyé avec succès ✅" });
  } catch (err) {
    console.error("Erreur Nodemailer backend:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
