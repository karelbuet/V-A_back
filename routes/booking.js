import express from "express";
import nodemailer from "nodemailer";
import Cart from "../models/cart.js";
import Booking from "../models/booking.js";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { rateLimitConfig } from "../middleware/security.js";
import { EmailActionService } from "../services/emailActionService.js";
import { EmailService } from "../services/emailService.js";

const router = express.Router();


// -------------------------
// 1. CRÉER DEMANDE DE RÉSERVATION
// -------------------------
router.post("/create-request", authenticateToken, async (req, res) => {
  try {
    const cart = await Cart.findOne({ userId: req.user.userId });
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ result: false, error: "Panier vide" });
    }

    // ✅ CORRECTION - Vérifier les conflits avant de créer la réservation
    for (const item of cart.items) {
      const conflictingBookings = await Booking.find({
        apartmentId: item.apartmentId,
        status: { $in: ["pending", "accepted", "confirmed"] },
        $or: [
          { startDate: { $lte: item.endDate }, endDate: { $gte: item.startDate } }
        ]
      });

      if (conflictingBookings.length > 0) {
        return res.status(400).json({
          result: false,
          error: `Dates non disponibles pour ${item.apartmentId}. Une réservation existe déjà sur cette période.`
        });
      }
    }

    // Créer un booking "en attente" pour chaque item
    const bookings = await Booking.insertMany(
      cart.items.map((item) => ({
        userId: req.user.userId,
        apartmentId: item.apartmentId,
        startDate: item.startDate,
        endDate: item.endDate,
        price: item.price,
        status: "pending", // En attente validation hôte
        bookedAt: new Date(),
      }))
    );

    // Envoyer un email à l'hôte avec le nouveau système de templates
    await EmailService.sendReservationEmail(bookings);

    // Vider le panier
    await Cart.deleteOne({ _id: cart._id });

    res.json({
      result: true,
      message: "Demande envoyée à l’hôte",
      bookings,
    });
  } catch (err) {
    console.error("Erreur create-request:", err);
    res.status(500).json({ result: false, error: "Erreur serveur" });
  }
});

// -------------------------
// 2. ADMIN ACCEPTE UNE DEMANDE - SÉCURISÉ
// -------------------------
router.post(
  "/accept/:id", 
  rateLimitConfig.auth, // Protection rate limiting
  authenticateToken,    // Vérification JWT
  requireRole(["admin"]), // Seuls les admins
  async (req, res) => {
    try {
      // Validation de l'ID MongoDB
      if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
        return res.status(400).json({ 
          result: false, 
          error: "ID de réservation invalide" 
        });
      }

      const booking = await Booking.findById(req.params.id);
      if (!booking) {
        return res.status(404).json({ 
          result: false, 
          error: "Réservation introuvable" 
        });
      }

      // Vérifier que le statut peut être modifié
      if (booking.status !== "pending") {
        return res.status(400).json({ 
          result: false, 
          error: "Cette réservation ne peut plus être modifiée" 
        });
      }

      booking.status = "accepted";
      await booking.save();

      // Log sécurisé pour audit
      console.log(`Admin ${req.user.userId} a accepté la réservation ${req.params.id}`);

      res.json({ 
        result: true, 
        message: "Réservation acceptée avec succès",
        bookingId: booking._id 
      });
    } catch (err) {
      console.error("Erreur accept:", err);
      res.status(500).json({ result: false, error: "Erreur serveur" });
    }
  }
);

// -------------------------
// 3. ADMIN REFUSE UNE DEMANDE - SÉCURISÉ
// -------------------------
router.post(
  "/refuse/:id", 
  rateLimitConfig.auth, // Protection rate limiting
  authenticateToken,    // Vérification JWT
  requireRole(["admin"]), // Seuls les admins
  async (req, res) => {
    try {
      // Validation de l'ID MongoDB
      if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
        return res.status(400).json({ 
          result: false, 
          error: "ID de réservation invalide" 
        });
      }

      const booking = await Booking.findById(req.params.id);
      if (!booking) {
        return res.status(404).json({ 
          result: false, 
          error: "Réservation introuvable" 
        });
      }

      // Vérifier que le statut peut être modifié
      if (booking.status !== "pending") {
        return res.status(400).json({ 
          result: false, 
          error: "Cette réservation ne peut plus être modifiée" 
        });
      }

      booking.status = "refused";
      await booking.save();

      // Log sécurisé pour audit
      console.log(`Admin ${req.user.userId} a refusé la réservation ${req.params.id}`);

      res.json({ 
        result: true, 
        message: "Réservation refusée avec succès",
        bookingId: booking._id 
      });
    } catch (err) {
      console.error("Erreur refuse:", err);
      res.status(500).json({ result: false, error: "Erreur serveur" });
    }
  }
);

// -------------------------
// 4. RÉCUPÉRER MES RÉSERVATIONS - AVEC PAGINATION
// -------------------------
router.get("/searchBookings", authenticateToken, async (req, res) => {
  try {
    // Paramètres de pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Validation des paramètres
    if (page < 1 || limit < 1 || limit > 100) {
      return res.status(400).json({ 
        result: false, 
        error: "Paramètres de pagination invalides (page >= 1, limit 1-100)" 
      });
    }

    // Requête avec pagination
    const [bookings, totalCount] = await Promise.all([
      Booking.find({ userId: req.user.userId })
        .sort({ bookedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(), // Performance: objet JS simple
      Booking.countDocuments({ userId: req.user.userId })
    ]);

    // Métadonnées de pagination
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    res.json({ 
      result: true, 
      bookings,
      pagination: {
        currentPage: page,
        totalPages,
        totalItems: totalCount,
        itemsPerPage: limit,
        hasNextPage,
        hasPrevPage,
        nextPage: hasNextPage ? page + 1 : null,
        prevPage: hasPrevPage ? page - 1 : null
      }
    });
  } catch (err) {
    console.error("Erreur searchBookings:", err);
    res.status(500).json({ result: false, error: "Erreur serveur" });
  }
});

// -------------------------
// 5. ADMIN - LISTER TOUTES LES RÉSERVATIONS EN ATTENTE - AVEC PAGINATION
// -------------------------
router.get(
  "/admin/pending", 
  authenticateToken,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      // Paramètres de pagination
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20; // Plus d'items par page pour admin
      const skip = (page - 1) * limit;

      // Validation des paramètres
      if (page < 1 || limit < 1 || limit > 100) {
        return res.status(400).json({ 
          result: false, 
          error: "Paramètres de pagination invalides (page >= 1, limit 1-100)" 
        });
      }

      // Requêtes parallèles pour performance
      const [bookings, totalCount] = await Promise.all([
        Booking.find({ status: "pending" })
          .populate("userId", "firstname lastname email")
          .sort({ bookedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(), // Performance: objet JS simple
        Booking.countDocuments({ status: "pending" })
      ]);

      // Métadonnées de pagination
      const totalPages = Math.ceil(totalCount / limit);
      const hasNextPage = page < totalPages;
      const hasPrevPage = page > 1;

      res.json({ 
        result: true, 
        bookings: bookings.map(booking => ({
          _id: booking._id,
          apartmentId: booking.apartmentId,
          startDate: booking.startDate,
          endDate: booking.endDate,
          price: booking.price,
          status: booking.status,
          bookedAt: booking.bookedAt,
          user: {
            firstname: booking.userId?.firstname,
            lastname: booking.userId?.lastname,
            email: booking.userId?.email
          }
        })),
        pagination: {
          currentPage: page,
          totalPages,
          totalItems: totalCount,
          itemsPerPage: limit,
          hasNextPage,
          hasPrevPage,
          nextPage: hasNextPage ? page + 1 : null,
          prevPage: hasPrevPage ? page - 1 : null
        }
      });
    } catch (err) {
      console.error("Erreur admin pending:", err);
      res.status(500).json({ result: false, error: "Erreur serveur" });
    }
  }
);

// -------------------------
// 6. ACTIONS PUBLIQUES VIA EMAIL - ROUTES SÉCURISÉES
// -------------------------

// Route publique pour les actions via email (accept/refuse)
router.get(
  "/email-action/:token", 
  rateLimitConfig.public, // Protection rate limiting pour routes publiques
  async (req, res) => {
    try {
      const { token } = req.params;
      
      // Validation basique du token
      if (!token || token.length !== 64) {
        return res.status(400).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <title>Action Invalide - ImmoVA</title>
            <style>
              body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
              .error { color: #d32f2f; background: #ffebee; padding: 20px; border-radius: 8px; }
            </style>
          </head>
          <body>
            <div class="error">
              <h2>❌ Action Invalide</h2>
              <p>Le lien utilisé n'est pas valide. Veuillez vérifier le lien dans votre email.</p>
            </div>
          </body>
          </html>
        `);
      }

      // Exécuter l'action via le service
      const result = await EmailActionService.executeTokenAction(token);
      
      if (!result.success) {
        return res.status(400).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <title>Action Échouée - ImmoVA</title>
            <style>
              body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
              .error { color: #d32f2f; background: #ffebee; padding: 20px; border-radius: 8px; }
            </style>
          </head>
          <body>
            <div class="error">
              <h2>❌ Action Échouée</h2>
              <p><strong>Erreur:</strong> ${result.error}</p>
              ${result.code === 'ALREADY_PROCESSED' ? 
                '<p>Cette réservation a déjà été traitée.</p>' : 
                '<p>Le lien a peut-être expiré ou est invalide.</p>'
              }
            </div>
          </body>
          </html>
        `);
      }

      // Succès - Afficher page de confirmation
      const actionText = result.action === 'accept' ? 'acceptée' : 'refusée';
      const actionColor = result.action === 'accept' ? '#4caf50' : '#ff9800';
      const actionIcon = result.action === 'accept' ? '✅' : '❌';
      
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Réservation ${actionText} - ImmoVA</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
            .success { color: ${actionColor}; background: #f1f8e9; padding: 30px; border-radius: 8px; text-align: center; }
            .booking-details { background: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 8px; }
            .detail-row { margin: 10px 0; }
            .label { font-weight: bold; color: #333; }
            .value { color: #666; }
          </style>
        </head>
        <body>
          <div class="success">
            <h1>${actionIcon} Réservation ${actionText}</h1>
            <p>L'action a été effectuée avec succès !</p>
          </div>
          
          <div class="booking-details">
            <h3>📋 Détails de la réservation</h3>
            <div class="detail-row">
              <span class="label">Client:</span> 
              <span class="value">${result.booking.user.firstname} ${result.booking.user.lastname}</span>
            </div>
            <div class="detail-row">
              <span class="label">Email:</span> 
              <span class="value">${result.booking.user.email}</span>
            </div>
            <div class="detail-row">
              <span class="label">Logement:</span> 
              <span class="value">${result.booking.apartmentId}</span>
            </div>
            <div class="detail-row">
              <span class="label">Période:</span> 
              <span class="value">Du ${new Date(result.booking.startDate).toLocaleDateString('fr-FR')} au ${new Date(result.booking.endDate).toLocaleDateString('fr-FR')}</span>
            </div>
            <div class="detail-row">
              <span class="label">Prix:</span> 
              <span class="value">${result.booking.price} €</span>
            </div>
            <div class="detail-row">
              <span class="label">Statut:</span> 
              <span class="value" style="color: ${actionColor}; font-weight: bold;">
                ${result.booking.status === 'accepted' ? 'Acceptée' : 'Refusée'}
              </span>
            </div>
          </div>
          
          <p style="text-align: center; color: #666; margin-top: 30px;">
            <small>Le client sera automatiquement notifié par email de cette décision.</small>
          </p>
        </body>
        </html>
      `);

    } catch (error) {
      console.error("Erreur action email:", error);
      res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Erreur - ImmoVA</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
            .error { color: #d32f2f; background: #ffebee; padding: 20px; border-radius: 8px; }
          </style>
        </head>
        <body>
          <div class="error">
            <h2>⚠️ Erreur Technique</h2>
            <p>Une erreur inattendue s'est produite. Veuillez réessayer plus tard ou contacter le support.</p>
          </div>
        </body>
        </html>
      `);
    }
  }
);

// -------------------------
// 7. PRÉVISUALISATION EMAIL (DEV SEULEMENT)
// -------------------------

// Route de test pour prévisualiser l'email
router.get(
  "/email-preview", 
  async (req, res) => {
    try {
      // Route accessible seulement en développement
      if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({ error: 'Route non disponible en production' });
      }

      // Générer un aperçu avec des données de test
      const htmlPreview = await EmailService.generatePreview();
      
      // Retourner directement le HTML pour visualisation
      res.setHeader('Content-Type', 'text/html');
      res.send(htmlPreview);
      
    } catch (error) {
      console.error("Erreur génération prévisualisation:", error);
      res.status(500).json({ error: "Erreur génération prévisualisation" });
    }
  }
);

// -------------------------
// UTILITAIRE : ENVOI EMAIL
// -------------------------
async function sendReservationEmail(bookings) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  let htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #1976d2; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0;">🏠 ImmoVA</h1>
        <h2 style="margin: 10px 0 0 0;">Nouvelle${bookings.length > 1 ? 's' : ''} demande${bookings.length > 1 ? 's' : ''} de réservation</h2>
      </div>
      <div style="background: #f5f5f5; padding: 20px;">
        <p style="color: #333; margin-bottom: 20px;">
          Vous avez reçu <strong>${bookings.length} nouvelle${bookings.length > 1 ? 's' : ''} demande${bookings.length > 1 ? 's' : ''}</strong> de réservation.
          Vous pouvez traiter chaque demande directement depuis cet email.
        </p>
      </div>
  `;
  // Traiter chaque réservation
  for (const booking of bookings) {
    try {
      // Générer les tokens d'action pour cette réservation
      const tokens = await EmailActionService.generateActionTokens(booking._id);
      
      const baseUrl = process.env.BACKEND_URL || 'http://localhost:3000';
      const acceptUrl = `${baseUrl}/booking/email-action/${tokens.acceptToken}`;
      const refuseUrl = `${baseUrl}/booking/email-action/${tokens.refuseToken}`;
      
      htmlContent += `
        <div style="background: white; margin: 20px 0; padding: 20px; border-radius: 8px; border-left: 4px solid #1976d2;">
          <h3 style="color: #1976d2; margin-top: 0;">📋 Réservation #${booking._id.toString().slice(-6)}</h3>
          
          <div style="background: #f8f9fa; padding: 15px; border-radius: 4px; margin: 15px 0;">
            <div style="margin-bottom: 10px;"><strong>🏡 Logement:</strong> ${booking.apartmentId}</div>
            <div style="margin-bottom: 10px;"><strong>📅 Période:</strong> Du ${new Date(booking.startDate).toLocaleDateString('fr-FR')} au ${new Date(booking.endDate).toLocaleDateString('fr-FR')}</div>
            <div style="margin-bottom: 10px;"><strong>💰 Prix:</strong> ${booking.price} €</div>
            <div style="margin-bottom: 10px;"><strong>⏰ Demande reçue:</strong> ${new Date(booking.bookedAt).toLocaleString('fr-FR')}</div>
          </div>

          <div style="text-align: center; margin: 25px 0;">
            <a href="${acceptUrl}" 
               style="display: inline-block; padding: 12px 25px; margin: 0 10px; background: #4caf50; color: white; text-decoration: none; border-radius: 25px; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
              ✅ ACCEPTER
            </a>
            <a href="${refuseUrl}" 
               style="display: inline-block; padding: 12px 25px; margin: 0 10px; background: #f44336; color: white; text-decoration: none; border-radius: 25px; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
              ❌ REFUSER
            </a>
          </div>

          <div style="background: #e3f2fd; padding: 10px; border-radius: 4px; font-size: 12px; color: #1565c0;">
            <strong>💡 Actions directes:</strong> Cliquez sur les boutons ci-dessus pour traiter cette réservation directement.
            <br>Une page de confirmation s'ouvrira et le client sera automatiquement notifié de votre décision.
            <br><strong>⏱️ Ces liens expirent dans 7 jours.</strong>
          </div>

          <div style="text-align: center; margin-top: 15px; padding-top: 15px; border-top: 1px solid #eee;">
            <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/compte?tab=admin&action=review&booking=${booking._id}"
               style="display: inline-block; padding: 8px 15px; background: #1976d2; color: white; text-decoration: none; border-radius: 4px; font-size: 12px;">
              📋 Voir dans l'interface admin
            </a>
          </div>
        </div>
      `;
    } catch (tokenError) {
      console.error('Erreur génération tokens pour booking', booking._id, ':', tokenError);
      // Fallback vers l'ancienne version si les tokens échouent
      htmlContent += `
        <div style="background: white; margin: 20px 0; padding: 20px; border-radius: 8px; border-left: 4px solid #ff9800;">
          <h3 style="color: #ff9800; margin-top: 0;">⚠️ Réservation #${booking._id.toString().slice(-6)}</h3>
          <p><strong>Logement:</strong> ${booking.apartmentId}</p>
          <p><strong>Période:</strong> Du ${new Date(booking.startDate).toLocaleDateString('fr-FR')} au ${new Date(booking.endDate).toLocaleDateString('fr-FR')}</p>
          <p><strong>Prix:</strong> ${booking.price} €</p>
          <div style="text-align: center; margin: 15px 0;">
            <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/compte?tab=admin&action=review&booking=${booking._id}"
               style="padding: 10px 20px; background: #1976d2; color: white; text-decoration: none; border-radius: 5px;">
               📋 Examiner cette réservation
            </a>
          </div>
          <p style="color: #ff9800; font-size: 12px;"><em>Actions rapides temporairement indisponibles - utilisez l'interface admin</em></p>
        </div>
      `;
    }
  }

  htmlContent += `
      <div style="background: #37474f; color: white; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; margin-top: 20px;">
        <p style="margin: 0; font-size: 14px;">
          <strong>🏠 ImmoVA</strong> - Système de réservation automatisé
        </p>
        <p style="margin: 10px 0 0 0; font-size: 12px; opacity: 0.8;">
          Cet email a été généré automatiquement. Les actions directes sont sécurisées et auditées.
        </p>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: `"🏠 ImmoVA - Réservations" <${process.env.SMTP_USER}>`,
    to: process.env.RECEIVER_EMAIL,
    subject: `📨 Nouvelle demande de réservation - ${bookings.length} demande(s)`,
    html: htmlContent,
  });
}

export default router;
