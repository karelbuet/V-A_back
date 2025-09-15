import express from "express";
import nodemailer from "nodemailer";
import Cart from "../models/cart.js";
import Booking from "../models/booking.js";
import GlobalSettings from "../models/globalSettings.js";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { rateLimitConfig } from "../middleware/security.js";
import { EmailActionService } from "../services/emailActionService.js";
import { EmailService } from "../services/emailService.js";

const router = express.Router();

// ✅ Fonction utilitaire pour formater les dates de façon cohérente
// Elle préserve la date logique stockée en UTC comme date de séjour
function formatDateUTC(dateString) {
  // Si la date est déjà au format ISO, on l'utilise directement
  if (typeof dateString === 'string' && dateString.includes('T')) {
    // Pour une date ISO comme "2025-09-22T00:00:00.000Z", on veut afficher 22/09/2025
    const dateParts = dateString.split('T')[0].split('-'); // ["2025", "09", "22"]
    return `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`; // "22/09/2025"
  }

  // Fallback pour les autres formats
  const date = new Date(dateString);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

// -------------------------
// 1. CRÉER DEMANDE DE RÉSERVATION
// -------------------------
router.post("/create-request", authenticateToken, async (req, res) => {
  try {
    console.log("🎯 [BOOKING] Début de la demande de réservation");
    console.log("📋 [BOOKING] User ID:", req.user.userId);
    console.log("📋 [BOOKING] Body reçu:", JSON.stringify(req.body, null, 2));

    // ✅ CORRECTION - Utiliser les items envoyés par le frontend
    const { items: cartItems, guestDetails } = req.body;

    // Validation des données reçues
    if (!cartItems || cartItems.length === 0) {
      console.log("❌ [BOOKING] Erreur: Panier vide");
      return res.status(400).json({ result: false, error: "Aucun article dans la demande de réservation" });
    }

    console.log(`✅ [BOOKING] ${cartItems.length} articles trouvés dans le panier`);

    // ✅ CORRECTION - Vérifier les conflits avant de créer la réservation
    console.log("🔍 [BOOKING] Vérification des conflits de dates...");
    for (const item of cartItems) {
      console.log(`🔍 [BOOKING] Vérification ${item.apartmentId} du ${item.startDate} au ${item.endDate}`);

      const conflictingBookings = await Booking.find({
        apartmentId: item.apartmentId,
        status: { $in: ["pending", "accepted", "confirmed"] },
        $or: [
          { startDate: { $lte: item.endDate }, endDate: { $gte: item.startDate } }
        ]
      });

      console.log(`🔍 [BOOKING] Conflits trouvés pour ${item.apartmentId}:`, conflictingBookings.length);

      if (conflictingBookings.length > 0) {
        console.log("❌ [BOOKING] Conflit détecté:", conflictingBookings);
        return res.status(400).json({
          result: false,
          error: `Dates non disponibles pour ${item.apartmentId}. Une réservation existe déjà sur cette période.`
        });
      }
    }
    console.log("✅ [BOOKING] Aucun conflit de dates détecté");

    // ✅ CORRECTION - Les détails invités sont déjà définis dans la destructuration
    // Validation des détails invités avec valeurs par défaut
    const validatedGuestDetails = {
      adults: guestDetails?.adults || 1,
      children: guestDetails?.children || [],
      pets: guestDetails?.pets || [],
      specialRequests: guestDetails?.specialRequests || "",
      arrivalTime: guestDetails?.arrivalTime || "",
      contactPhone: guestDetails?.contactPhone || "",
      includeCleaning: guestDetails?.includeCleaning || false,
      includeLinen: guestDetails?.includeLinen || false
    };

    // Récupérer les paramètres globaux pour les services
    let cleaningFee = 0;
    let linenFee = 0;

    try {
      const cleaningSetting = await GlobalSettings.findOne({ settingKey: "cleaning_fee" });
      const linenSetting = await GlobalSettings.findOne({ settingKey: "linen_option_price" });

      cleaningFee = cleaningSetting ? cleaningSetting.settingValue : 0;
      linenFee = linenSetting ? linenSetting.settingValue : 25; // Prix par défaut 25€
    } catch (settingsError) {
      console.error("Erreur récupération paramètres globaux:", settingsError);
      // Continuer avec des frais à 0
    }

    console.log("💾 [BOOKING] Préparation de l'insertion en base...");
    console.log("💾 [BOOKING] Détails invités validés:", validatedGuestDetails);

    const bookingDocuments = cartItems.map((item) => {
      // Calculer les services additionnels
      const includeCleaning = validatedGuestDetails.includeCleaning;
      const includeLinen = validatedGuestDetails.includeLinen;

      const cleaningCost = includeCleaning ? cleaningFee : 0;
      const linenCost = includeLinen ? linenFee : 0;
      const totalPrice = item.price + cleaningCost + linenCost;

      const bookingDoc = {
        userId: req.user.userId,
        apartmentId: item.apartmentId,
        startDate: item.startDate,
        endDate: item.endDate,
        price: item.price, // Prix de base du logement
        totalPrice: totalPrice, // Prix total avec services
        status: "pending", // En attente validation hôte
        bookedAt: new Date(),
        guestDetails: {
          adults: validatedGuestDetails.adults,
          children: validatedGuestDetails.children,
          pets: validatedGuestDetails.pets,
          specialRequests: validatedGuestDetails.specialRequests,
          arrivalTime: validatedGuestDetails.arrivalTime,
          contactPhone: validatedGuestDetails.contactPhone
        },
        additionalServices: {
          cleaning: {
            included: includeCleaning,
            price: cleaningCost
          },
          linen: {
            included: includeLinen,
            price: linenCost
          }
        }
      };

      console.log(`💾 [BOOKING] Document préparé pour ${item.apartmentId}:`, bookingDoc);
      return bookingDoc;
    });

    console.log(`💾 [BOOKING] Insertion de ${bookingDocuments.length} réservations...`);
    const bookings = await Booking.insertMany(bookingDocuments);
    console.log(`✅ [BOOKING] ${bookings.length} réservations insérées avec succès!`);

    // Envoyer un email à l'hôte avec le nouveau système de templates
    console.log("📧 [BOOKING] Envoi de l'email à l'hôte...");
    try {
      await EmailService.sendReservationEmail(bookings);
      console.log("✅ [BOOKING] Email envoyé avec succès");
    } catch (emailError) {
      console.error("⚠️ [BOOKING] Erreur envoi email (non bloquant):", emailError);
      // Ne pas bloquer la réservation si l'email échoue
    }

    // ✅ CORRECTION - Optionnel: Vider le panier côté serveur si il existe
    // (Le frontend se charge déjà de vider le panier côté client)
    try {
      const cartDeleteResult = await Cart.deleteOne({ userId: req.user.userId });
      console.log("🗑️ [BOOKING] Suppression panier serveur:", cartDeleteResult);
    } catch (cartError) {
      console.log("ℹ️ [BOOKING] Info: Aucun panier côté serveur à supprimer");
    }

    console.log("🎉 [BOOKING] Réservation terminée avec succès!");
    console.log("🎉 [BOOKING] IDs des réservations créées:", bookings.map(b => b._id));

    res.json({
      result: true,
      message: "Demande envoyée à l'hôte",
      bookings: bookings.map(b => ({
        _id: b._id,
        apartmentId: b.apartmentId,
        startDate: b.startDate,
        endDate: b.endDate,
        price: b.price,
        totalPrice: b.totalPrice,
        status: b.status
      })),
    });
  } catch (err) {
    console.error("❌ [BOOKING] ERREUR CRITIQUE create-request:", err);
    console.error("❌ [BOOKING] Stack trace:", err.stack);
    res.status(500).json({ result: false, error: "Erreur serveur lors de la création de la réservation" });
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
// 5. ADMIN - LISTER TOUTES LES RÉSERVATIONS - AVEC PAGINATION
// -------------------------
router.get(
  "/all",
  authenticateToken,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      // Paramètres de pagination
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;
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
        Booking.find({})
          .populate("userId", "firstname lastname email phone")
          .sort({ bookedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Booking.countDocuments({})
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
      console.error("Erreur admin all bookings:", err);
      res.status(500).json({ result: false, error: "Erreur serveur" });
    }
  }
);

// -------------------------
// 6. ADMIN - LISTER TOUTES LES RÉSERVATIONS EN ATTENTE - AVEC PAGINATION
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
              <span class="value">Du ${formatDateUTC(result.booking.startDate)} au ${formatDateUTC(result.booking.endDate)}</span>
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
// NOTE : ANCIEN SYSTÈME EMAIL REMPLACÉ
// -------------------------
// L'ancienne fonction sendReservationEmail a été remplacée par
// EmailService.sendReservationEmail qui utilise le système de templates
// modulaire dans services/emailService.js et services/emailTemplateService.js

export default router;
