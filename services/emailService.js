import nodemailer from "nodemailer";
import { EmailTemplateService } from "./emailTemplateService.js";

export class EmailService {
  
  /**
   * Envoie un email de réservation avec templates
   * @param {Array} bookings - Liste des réservations
   */
  static async sendReservationEmail(bookings) {
    try {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      // Générer l'email avec le système de templates
      const htmlContent = await EmailTemplateService.generateBookingEmail(bookings);

      await transporter.sendMail({
        from: `"🏠 ImmoVA - Réservations" <${process.env.SMTP_USER}>`,
        to: process.env.RECEIVER_EMAIL,
        subject: `📨 Nouvelle demande de réservation - ${bookings.length} demande(s)`,
        html: htmlContent,
      });

      console.log(`✅ Email envoyé avec succès pour ${bookings.length} réservation(s)`);
      
    } catch (error) {
      console.error('❌ Erreur envoi email:', error);
      throw error;
    }
  }

  /**
   * Génère un aperçu de l'email (pour tests/développement)
   * @param {Array} sampleBookings - Données d'exemple (optionnel)
   * @returns {string} HTML de l'email
   */
  static async generatePreview(sampleBookings = null) {
    return await EmailTemplateService.generateBookingEmail(sampleBookings || [
      {
        _id: { toString: () => 'abc123def456ghi789jkl012mno345pqr678' },
        apartmentId: 'valery-sources-baie',
        startDate: new Date('2025-01-15'),
        endDate: new Date('2025-01-22'),
        price: 650,
        bookedAt: new Date()
      }
    ]);
  }
}