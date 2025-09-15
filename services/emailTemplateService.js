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

          const baseUrl = process.env.BACKEND_URL;
          const frontendUrl = process.env.FRONTEND_URL;

          // Variables pour cette réservation
          const bookingVariables = {
            BOOKING_ID_SHORT: booking._id.toString().slice(-6),
            APARTMENT_ID: booking.apartmentId,
            START_DATE: new Date(booking.startDate).toLocaleDateString("fr-FR"),
            END_DATE: new Date(booking.endDate).toLocaleDateString("fr-FR"),
            PRICE: booking.price,
            TOTAL_PRICE: booking.totalPrice || booking.price,
            BOOKED_AT: new Date(booking.bookedAt).toLocaleString("fr-FR"),
            ACCEPT_URL: `${baseUrl}/booking/email-action/${tokens.acceptToken}`,
            REFUSE_URL: `${baseUrl}/booking/email-action/${tokens.refuseToken}`,
            ADMIN_URL: `${frontendUrl}/compte?tab=admin&action=review&booking=${booking._id}`,

            // Informations voyageurs
            ADULTS: booking.guestDetails?.adults || 1,

            // Services additionnels conditionnels
            CLEANING_FEE_ROW:
              booking.additionalServices?.cleaning?.price > 0
                ? `<div class="detail-row"><span class="detail-label">🧹 Frais ménage: </span><span class="detail-value">${booking.additionalServices.cleaning.price} €</span></div>`
                : "",

            LINEN_OPTION_ROW: booking.additionalServices?.linen?.included
              ? `<div class="detail-row"><span class="detail-label">🛏️ Pack linge: </span><span class="detail-value">${booking.additionalServices.linen.price} €</span></div>`
              : "",

            // Enfants conditionnels
            CHILDREN_ROW:
              booking.guestDetails?.children &&
              booking.guestDetails.children.length > 0
                ? `<div class="detail-row"><span class="detail-label">Enfants: </span><span class="detail-value">${
                    booking.guestDetails.children.length
                  } (âges: ${booking.guestDetails.children
                    .map((c) => c.age + " ans")
                    .join(", ")})</span></div>`
                : "",

            // Section animaux conditionnelle
            PETS_SECTION:
              booking.guestDetails?.pets && booking.guestDetails.pets.length > 0
                ? `<div class="detail-row"><span class="detail-label">Animaux: </span><span class="detail-value">${booking.guestDetails.pets.length}</span></div>` +
                  booking.guestDetails.pets
                    .map(
                      (p) =>
                        `<div class="pet-detail">• ${p.type} (${p.breed}, ${p.weight}kg)</div>`
                    )
                    .join("")
                : "",

            // Contact téléphone conditionnel
            CONTACT_PHONE_ROW: booking.guestDetails?.contactPhone
              ? `<div class="detail-row"><span class="detail-label">📞 Téléphone: </span><span class="detail-value">${booking.guestDetails.contactPhone}</span></div>`
              : "",

            // Message conditionnel
            SPECIAL_REQUESTS_ROW: booking.guestDetails?.specialRequests
              ? `<div class="detail-row special-request"><span class="detail-label">💬 Message: </span><span class="detail-value"><em>${booking.guestDetails.specialRequests}</em></span></div>`
              : "",
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
          const frontendUrl = process.env.FRONTEND_URL;

          const fallbackVariables = {
            BOOKING_ID_SHORT: booking._id.toString().slice(-6),
            APARTMENT_ID: booking.apartmentId,
            START_DATE: new Date(booking.startDate).toLocaleDateString("fr-FR"),
            END_DATE: new Date(booking.endDate).toLocaleDateString("fr-FR"),
            PRICE: booking.price,
            TOTAL_PRICE: booking.totalPrice || booking.price,
            BOOKED_AT: new Date(booking.bookedAt).toLocaleString("fr-FR"),
            ADMIN_URL: `${frontendUrl}/compte?tab=admin&action=review&booking=${booking._id}`,

            // Inclure toutes les informations même en mode fallback
            ADULTS: booking.guestDetails?.adults || 1,

            // Services additionnels conditionnels
            CLEANING_FEE_ROW:
              booking.additionalServices?.cleaning?.price > 0
                ? `<div class="detail-row"><span class="detail-label">🧹 Frais ménage: </span><span class="detail-value">${booking.additionalServices.cleaning.price} €</span></div>`
                : "",

            LINEN_OPTION_ROW: booking.additionalServices?.linen?.included
              ? `<div class="detail-row"><span class="detail-label">🛏️ Pack linge: </span><span class="detail-value">${booking.additionalServices.linen.price} €</span></div>`
              : "",

            // Enfants conditionnels
            CHILDREN_ROW:
              booking.guestDetails?.children &&
              booking.guestDetails.children.length > 0
                ? `<div class="detail-row"><span class="detail-label">Enfants: </span><span class="detail-value">${
                    booking.guestDetails.children.length
                  } (âges: ${booking.guestDetails.children
                    .map((c) => c.age + " ans")
                    .join(", ")})</span></div>`
                : "",

            // Section animaux conditionnelle
            PETS_SECTION:
              booking.guestDetails?.pets && booking.guestDetails.pets.length > 0
                ? `<div class="detail-row"><span class="detail-label">Animaux: </span><span class="detail-value">${booking.guestDetails.pets.length}</span></div>` +
                  booking.guestDetails.pets
                    .map(
                      (p) =>
                        `<div class="pet-detail">• ${p.type} (${p.breed}, ${p.weight}kg)</div>`
                    )
                    .join("")
                : "",

            // Contact téléphone conditionnel
            CONTACT_PHONE_ROW: booking.guestDetails?.contactPhone
              ? `<div class="detail-row"><span class="detail-label">📞 Téléphone: </span><span class="detail-value">${booking.guestDetails.contactPhone}</span></div>`
              : "",

            // Message conditionnel
            SPECIAL_REQUESTS_ROW: booking.guestDetails?.specialRequests
              ? `<div class="detail-row special-request"><span class="detail-label">💬 Message: </span><span class="detail-value"><em>${booking.guestDetails.specialRequests}</em></span></div>`
              : "",
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
