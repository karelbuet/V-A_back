import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.join(__dirname, "..", "templates");

export class EmailTemplateService {
  /**
   * Charge un template HTML depuis un fichier
   * @param {string} templateName - Nom du fichier template (sans .html)
   * @returns {string} Contenu HTML du template
   */
  static loadTemplate(templateName) {
    try {
      const templatePath = path.join(TEMPLATES_DIR, `${templateName}.html`);
      return fs.readFileSync(templatePath, "utf8");
    } catch (error) {
      console.error(`Erreur chargement template ${templateName}:`, error);
      throw new Error(`Template ${templateName} introuvable`);
    }
  }

  /**
   * Remplace les variables dans un template
   * @param {string} template - Template HTML avec variables {{VAR}}
   * @param {Object} variables - Objet avec les valeurs de remplacement
   * @returns {string} HTML avec variables remplacées
   */
  static replaceVariables(template, variables) {
    let result = template;

    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{${key}}}`, "g");
      result = result.replace(regex, value || "");
    }

    return result;
  }

  /**
   * Génère l'email complet pour les réservations
   * @param {Array} bookings - Liste des réservations
   * @returns {string} HTML complet de l'email
   */
  static async generateBookingEmail(bookings) {
    try {
      // Charger le template principal
      const mainTemplate = this.loadTemplate("booking-email");
      const cardTemplate = this.loadTemplate("booking-card");
      const fallbackTemplate = this.loadTemplate("booking-card-fallback");

      const bookingsCount = bookings.length;
      const pluralS = bookingsCount > 1 ? "s" : "";

      // Variables globales
      const globalVariables = {
        HEADER_TITLE: `Nouvelle${pluralS} demande${pluralS} de réservation`,
        BOOKINGS_COUNT: bookingsCount,
        PLURAL_S: pluralS,
      };

      // Générer le contenu des réservations
      let bookingsContent = "";

      for (const booking of bookings) {
        try {
          // Générer les tokens d'action
          const { EmailActionService } = await import(
            "./emailActionService.js"
          );
          const tokens = await EmailActionService.generateActionTokens(
            booking._id
          );

          const baseUrl = process.env.BACKEND_URL || "http://localhost:3000";
          const frontendUrl =
            process.env.FRONTEND_URL || "http://localhost:5173";

          // Variables pour cette réservation
          const bookingVariables = {
            BOOKING_ID_SHORT: booking._id.toString().slice(-6),
            APARTMENT_ID: booking.apartmentId,
            START_DATE: new Date(booking.startDate).toLocaleDateString("fr-FR"),
            END_DATE: new Date(booking.endDate).toLocaleDateString("fr-FR"),
            PRICE: booking.price,
            BOOKED_AT: new Date(booking.bookedAt).toLocaleString("fr-FR"),
            ACCEPT_URL: `${baseUrl}/booking/email-action/${tokens.acceptToken}`,
            REFUSE_URL: `${baseUrl}/booking/email-action/${tokens.refuseToken}`,
            ADMIN_URL: `${frontendUrl}/compte?tab=admin&action=review&booking=${booking._id}`,
          };

          // Utiliser le template normal
          bookingsContent += this.replaceVariables(
            cardTemplate,
            bookingVariables
          );
        } catch (tokenError) {
          console.error(
            "Erreur génération tokens pour booking",
            booking._id,
            ":",
            tokenError
          );

          // Utiliser le template fallback
          const frontendUrl =
            process.env.FRONTEND_URL || "http://localhost:5173";

          const fallbackVariables = {
            BOOKING_ID_SHORT: booking._id.toString().slice(-6),
            APARTMENT_ID: booking.apartmentId,
            START_DATE: new Date(booking.startDate).toLocaleDateString("fr-FR"),
            END_DATE: new Date(booking.endDate).toLocaleDateString("fr-FR"),
            PRICE: booking.price,
            BOOKED_AT: new Date(booking.bookedAt).toLocaleString("fr-FR"),
            ADMIN_URL: `${frontendUrl}/compte?tab=admin&action=review&booking=${booking._id}`,
          };

          bookingsContent += this.replaceVariables(
            fallbackTemplate,
            fallbackVariables
          );
        }
      }

      // Variables finales avec le contenu des réservations
      const finalVariables = {
        ...globalVariables,
        BOOKINGS_CONTENT: bookingsContent,
      };

      // Générer l'email final
      return this.replaceVariables(mainTemplate, finalVariables);
    } catch (error) {
      console.error("Erreur génération email:", error);
      throw new Error("Impossible de générer l'email de réservation");
    }
  }
}

export default EmailTemplateService;
