import express from "express";
import Cart from "../models/cart.js";
import Booking from "../models/booking.js";
import { authenticateToken } from "../middleware/auth.js";
import fetch from "node-fetch";
import nodemailer from "nodemailer";

const router = express.Router();

// ======================================
// --- CART MANAGEMENT ROUTES ---
// ======================================

// --- Get Current Cart ---
router.get("/", authenticateToken, async (req, res) => {
  try {
    let cart = await Cart.findOne({ userId: req.user.userId });

    // Si le panier existe mais est expiré, on le supprime
    if (cart && cart.expiresAt < new Date()) {
      await Cart.deleteOne({ _id: cart._id });
      cart = null;
    }

    // Si pas de panier, on crée un nouveau panier vide
    if (!cart) {
      const newCart = new Cart({
        userId: req.user.userId,
        items: [],
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min
      });
      await newCart.save();
      cart = newCart;
    }

    // Toujours renvoyer result: true avec cart
    res.json({ result: true, cart });
  } catch (err) {
    console.error("Erreur getCart:", err);
    res.status(500).json({ result: false, error: "Erreur serveur" });
  }
});

// --- Add Item to Cart ---
router.post("/add", authenticateToken, async (req, res) => {
  try {
    const { apartmentId, startDate, endDate, price } = req.body;
    if (!apartmentId || !startDate || !endDate || !price) {
      return res.status(400).json({ result: false, error: "Champs manquants" });
    }

    // ✅ CORRECTION - Vérifier les conflits en excluant les jours de départ/arrivée
    const itemStart = new Date(startDate);
    const itemEnd = new Date(endDate);

    const conflictingBookings = await Booking.find({
      apartmentId,
      status: { $in: ["pending", "accepted", "confirmed"] },
      $or: [
        // Conflit réel : chevauchement SAUF si endDate existant = startDate nouveau (départ = arrivée OK)
        {
          startDate: { $lt: itemEnd }, // Début existant < fin nouveau (strictement)
          endDate: { $gt: itemStart }  // Fin existant > début nouveau (strictement)
        }
      ]
    });

    if (conflictingBookings.length > 0) {
      return res.status(400).json({
        result: false,
        error: "Ces dates ne sont plus disponibles. Une réservation existe déjà sur cette période."
      });
    }

    let cart = await Cart.findOne({ userId: req.user.userId });

    if (!cart) {
      cart = new Cart({
        userId: req.user.userId,
        items: [],
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min
      });
    }

    cart.items.push({ apartmentId, startDate, endDate, price });
    // Prolonge expiration à chaque ajout
    cart.expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await cart.save();
    res.json({ result: true, cart });
  } catch (err) {
    console.error(err);
    res.status(500).json({ result: false, error: "Erreur serveur" });
  }
});

// --- Delete All Cart Items ---
router.delete("/deleteAll", authenticateToken, async (req, res) => {
  try {
    // Utiliser findOneAndUpdate pour vider le tableau items
    const cart = await Cart.findOneAndUpdate(
      { userId: req.user.userId },
      { $set: { items: [] } },
      { new: true } // Retourner le document mis à jour
    );

    if (!cart) {
      return res
        .status(404)
        .json({ result: false, error: "Panier introuvable" });
    }

    res.json({ result: true, cart });
  } catch (err) {
    console.error("Erreur deleteAll:", err);
    res.status(500).json({ result: false, error: "Erreur serveur" });
  }
});

// --- Delete Single Cart Item ---
router.delete("/:itemId", authenticateToken, async (req, res) => {
  try {
    const { itemId } = req.params;

    // Utiliser findOneAndUpdate avec $pull pour supprimer le sous-document
    const cart = await Cart.findOneAndUpdate(
      { userId: req.user.userId },
      { $pull: { items: { _id: itemId } } },
      { new: true } // Retourner le document mis à jour
    );

    if (!cart) {
      return res
        .status(404)
        .json({ result: false, error: "Panier introuvable" });
    }

    res.json({ result: true, cart });
  } catch (err) {
    console.error("Erreur suppression item:", err);
    res.status(500).json({ result: false, error: "Erreur serveur" });
  }
});

// ======================================
// --- CHECKOUT & PAYMENT ROUTES ---
// ======================================

// --- Transform Cart to Booking ---
router.post("/checkout", authenticateToken, async (req, res) => {
  try {
    const cart = await Cart.findOne({ userId: req.user.userId });
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ result: false, error: "Panier vide" });
    }

    if (cart.expiresAt < new Date()) {
      await Cart.deleteOne({ _id: cart._id });
      return res.status(410).json({ result: false, error: "Panier expiré" });
    }

    // Calculer le total
    const totalPrice = cart.items.reduce((sum, item) => sum + item.price, 0);

    // Pour l'instant, retourner les infos sans créer de commande complexe
    res.json({
      result: true,
      order: {
        orderId: `temp_${Date.now()}`,
        totalPrice,
        items: cart.items,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
      message: "Prêt pour le paiement",
    });
  } catch (err) {
    console.error("Erreur checkout:", err);
    res.status(500).json({ result: false, error: "Erreur serveur" });
  }
});

// --- Validate Payment (Simplified) ---
router.post("/validate-payment", authenticateToken, async (req, res) => {
  try {
    const { orderId, paymentId } = req.body;

    const cart = await Cart.findOne({ userId: req.user.userId });
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ result: false, error: "Panier vide" });
    }

    if (cart.expiresAt < new Date()) {
      await Cart.deleteOne({ _id: cart._id });
      return res.status(410).json({ result: false, error: "Panier expiré" });
    }

    // Créer des bookings pour chaque item (logique existante)
    const bookings = await Booking.insertMany(
      cart.items.map((item) => ({
        userId: req.user.userId,
        apartmentId: item.apartmentId,
        startDate: item.startDate,
        endDate: item.endDate,
        price: item.price,
        bookedAt: new Date(),
        paymentId: paymentId, // Ajouter l'ID de paiement
      }))
    );

    // Supprimer le panier
    await Cart.deleteOne({ _id: cart._id });

    res.json({ result: true, bookings, message: "Paiement validé" });
  } catch (err) {
    console.error("Erreur validate-payment:", err);
    res.status(500).json({ result: false, error: "Erreur serveur" });
  }
});


// --- Capture PayPal Order ---
router.get("/capture-paypal-order", authenticateToken, async (req, res) => {
  try {
    const { token } = req.query; // PayPal renvoie `token` dans return_url
    if (!token)
      return res.status(400).json({ success: false, error: "Token manquant" });

    // Capture du paiement PayPal
    const response = await fetch(
      `https://api-m.sandbox.paypal.com/v2/checkout/orders/${token}/capture`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(
            `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`
          ).toString("base64")}`,
        },
      }
    );

    const data = await response.json();
    if (!data || !data.status) {
      return res
        .status(500)
        .json({ success: false, error: "Réponse PayPal invalide", data });
    }

    // Vérification statut
    if (data.status !== "COMPLETED") {
      return res
        .status(400)
        .json({ success: false, error: "Paiement non complété", data });
    }

    // Récupération infos
    const transactionId = data.id;
    const payerEmail = data.payer?.email_address;

    // ⚡ Mise à jour de la réservation en BDD
    // Le token PayPal correspond à l'ID de l'ordre PayPal, pas à la réservation
    // Il faut d'abord retrouver quelle réservation correspond à ce paiement
    // Pour l'instant, on met à jour la réservation de l'utilisateur connecté qui est "accepted"
    const updatedBooking = await Booking.findOneAndUpdate(
      { 
        userId: req.user.userId, 
        status: "accepted" 
      },
      { 
        status: "confirmed", 
        paymentDate: new Date(), 
        paymentId: transactionId,
        paypalOrderId: token 
      },
      { new: true }
    );

    if (!updatedBooking) {
      return res
        .status(404)
        .json({ success: false, error: "Réservation non trouvée pour ce paiement" });
    }

    // Récupérer le montant réellement payé depuis PayPal
    const paidAmount = data.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value || updatedBooking.totalPrice || updatedBooking.price;

    // ✅ CORRECTION - Email confirmation client depuis notre BD utilisateur
    try {
      // Récupérer l'email de l'utilisateur depuis notre base de données
      const User = (await import("../models/users.js")).default;
      const clientUser = await User.findById(req.user.userId);

      if (clientUser && clientUser.email) {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || "smtp.gmail.com",
          port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 465,
          secure: true,
          auth: {
            user: process.env.RECEIVER_EMAIL,
            pass: process.env.SMTP_PASS,
          },
        });

        await transporter.sendMail({
          from: `"🏠 ImmoVA - Paiement" <${process.env.RECEIVER_EMAIL}>`,
          to: clientUser.email,
          subject: "✅ Confirmation de paiement - Réservation confirmée",
          html: `
            <h2>Bonjour ${clientUser.firstname} ${clientUser.lastname},</h2>
            <p>Votre paiement de <strong>${paidAmount} €</strong> a bien été reçu ✅.</p>
            <p><strong>Votre réservation est maintenant confirmée !</strong></p>
            <hr style="margin: 20px 0;">
            <p><strong>📋 Détails de votre réservation :</strong></p>
            <p>• Numéro : <strong>${updatedBooking._id}</strong></p>
            <p>• Logement : <strong>${updatedBooking.apartmentId}</strong></p>
            <p>• Période : Du ${new Date(updatedBooking.startDate).toLocaleDateString()} au ${new Date(updatedBooking.endDate).toLocaleDateString()}</p>
            <p>• Montant payé : <strong>${paidAmount} €</strong></p>
            <hr style="margin: 20px 0;">
            <p>💡 <strong>Informations importantes :</strong></p>
            <p>• Vous recevrez les informations d'accès quelques jours avant votre arrivée</p>
            <p>• Pour toute question, n'hésitez pas à nous contacter</p>
            <br>
            <p>Merci de votre confiance ! 🏠</p>
            <p><em>L'équipe ImmoVA</em></p>
          `,
        });

        console.log(`✅ Email de confirmation de paiement envoyé au client: ${clientUser.email}`);
      } else {
        console.log(`⚠️ Impossible d'envoyer l'email de confirmation : utilisateur ou email introuvable`);
        // Fallback avec l'email PayPal si disponible
        if (payerEmail) {
          console.log(`🔄 Tentative avec l'email PayPal: ${payerEmail}`);
          const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || "smtp.gmail.com",
            port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 465,
            secure: true,
            auth: {
              user: process.env.RECEIVER_EMAIL,
              pass: process.env.SMTP_PASS,
            },
          });

          await transporter.sendMail({
            from: `"🏠 ImmoVA - Paiement" <${process.env.RECEIVER_EMAIL}>`,
            to: payerEmail,
            subject: "✅ Confirmation de paiement",
            html: `
              <h2>Bonjour,</h2>
              <p>Votre paiement de <strong>${paidAmount} €</strong> a bien été reçu ✅.</p>
              <p>Numéro de réservation : <strong>${updatedBooking._id}</strong></p>
              <p>Appartement : ${updatedBooking.apartmentId}</p>
              <p>Du ${new Date(updatedBooking.startDate).toLocaleDateString()} au ${new Date(updatedBooking.endDate).toLocaleDateString()}</p>
              <p>Merci de votre confiance.</p>
            `,
          });
          console.log(`✅ Email de confirmation envoyé via PayPal email: ${payerEmail}`);
        }
      }
    } catch (emailError) {
      console.error("⚠️ Erreur envoi email confirmation client (non bloquant):", emailError);
    }

    // Email admin
    const adminTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 465,
      secure: true,
      auth: {
        user: process.env.RECEIVER_EMAIL,
        pass: process.env.SMTP_PASS,
      },
    });

    await adminTransporter.sendMail({
      from: `"VILEAU" <${process.env.RECEIVER_EMAIL}>`,
      to: process.env.RECEIVER_EMAIL,
      subject: "Nouvelle réservation payée",
      html: `
        <h2>Nouvelle réservation confirmée 🎉</h2>
        <p>Client : ${payerEmail}</p>
        <p>Montant payé : <strong>${paidAmount} €</strong></p>
        <p>Réservation : ${updatedBooking._id}</p>
        <p>Appartement : ${updatedBooking.apartmentId}</p>
        <p>Période : ${new Date(updatedBooking.startDate).toLocaleDateString()} - ${new Date(updatedBooking.endDate).toLocaleDateString()}</p>
      `,
    });

    // ✅ NOUVEAU - Email à la personne tiers (préparation logements)
    if (process.env.THIRD_PARTY_EMAIL) {
      try {
        // Récupérer les infos client pour l'email tiers
        const User = (await import("../models/users.js")).default;
        const clientUser = await User.findById(req.user.userId);

        const thirdPartyTransporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || "smtp.gmail.com",
          port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 465,
          secure: true,
          auth: {
            user: process.env.RECEIVER_EMAIL,
            pass: process.env.SMTP_PASS,
          },
        });

        // Déterminer si c'est un paiement partiel ou complet
        const totalPrice = updatedBooking.totalPrice || updatedBooking.price;
        const isPartialPayment = parseFloat(paidAmount) < parseFloat(totalPrice);
        const paymentType = isPartialPayment ? "ACCOMPTE" : "PAIEMENT COMPLET";

        await thirdPartyTransporter.sendMail({
          from: `"🏠 ImmoVA - Préparation" <${process.env.RECEIVER_EMAIL}>`,
          to: process.env.THIRD_PARTY_EMAIL,
          subject: `🔔 Nouvelle arrivée à préparer - ${updatedBooking.apartmentId}`,
          html: `
            <h2>🏠 Nouvelle réservation confirmée - Préparation requise</h2>
            <hr>

            <h3>📋 Informations logement :</h3>
            <p><strong>Logement :</strong> ${updatedBooking.apartmentId}</p>
            <p><strong>Arrivée :</strong> ${new Date(updatedBooking.startDate).toLocaleDateString("fr-FR")}</p>
            <p><strong>Départ :</strong> ${new Date(updatedBooking.endDate).toLocaleDateString("fr-FR")}</p>
            <p><strong>Réservation :</strong> #${updatedBooking._id}</p>

            <hr>

            <h3>👥 Informations client :</h3>
            <p><strong>Nom :</strong> ${clientUser?.lastname || 'N/C'} ${clientUser?.firstname || 'N/C'}</p>
            <p><strong>Email :</strong> ${clientUser?.email || payerEmail || 'N/C'}</p>
            <p><strong>Téléphone :</strong> ${updatedBooking.guestDetails?.contactPhone || clientUser?.phone || 'N/C'}</p>

            <hr>

            <h3>🎫 Détails séjour :</h3>
            <p><strong>Adultes :</strong> ${updatedBooking.guestDetails?.adults || 1}</p>
            <p><strong>Enfants :</strong> ${updatedBooking.guestDetails?.children?.length || 0}</p>
            <p><strong>Animaux :</strong> ${updatedBooking.guestDetails?.pets?.length || 0}</p>
            <p><strong>Pack linge :</strong> ${updatedBooking.additionalServices?.linen?.included ? '✅ OUI' : '❌ NON'}</p>

            <hr>

            <h3>💰 Paiement :</h3>
            <p><strong>Type :</strong> <span style="color: ${isPartialPayment ? 'orange' : 'green'}; font-weight: bold;">${paymentType}</span></p>
            <p><strong>Montant payé :</strong> ${paidAmount} €</p>
            ${isPartialPayment ? `<p><strong>Montant total :</strong> ${totalPrice} €</p>` : ''}

            <hr>

            ${updatedBooking.guestDetails?.specialRequests ? `
            <h3>💬 Demandes spéciales :</h3>
            <p><em>"${updatedBooking.guestDetails.specialRequests}"</em></p>
            <hr>
            ` : ''}

            <p style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <strong>📝 Action requise :</strong> Merci de préparer le logement pour l'arrivée du ${new Date(updatedBooking.startDate).toLocaleDateString("fr-FR")}.
            </p>

            <p><em>Cet email est généré automatiquement par le système ImmoVA.</em></p>
          `,
        });

        console.log(`✅ Email de préparation envoyé à la personne tiers: ${process.env.THIRD_PARTY_EMAIL}`);
      } catch (thirdPartyError) {
        console.error("⚠️ Erreur envoi email personne tiers (non bloquant):", thirdPartyError);
      }
    }

    // Réponse front
    res.json({ success: true, booking: updatedBooking });
  } catch (err) {
    console.error("Erreur capture PayPal:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Create PayPal Order ---
router.post("/create-paypal-order", authenticateToken, async (req, res) => {
  try {
    const { orderId, amountToPay } = req.body;

    // L'orderId correspond à l'ID de la réservation acceptée (depuis "Mes locations")
    if (!orderId) {
      return res.status(400).json({ result: false, error: "ID de réservation manquant" });
    }

    // Vérifier que la réservation existe et appartient à l'utilisateur connecté
    const booking = await Booking.findOne({ 
      _id: orderId, 
      userId: req.user.userId,
      status: "accepted" // Seules les réservations acceptées peuvent être payées
    });

    if (!booking) {
      return res.status(404).json({ 
        result: false, 
        error: "Réservation non trouvée ou non autorisée pour le paiement" 
      });
    }

    // Utiliser amountToPay si fourni, sinon utiliser le prix de la réservation
    const totalPrice = amountToPay || booking.price;


    const response = await fetch(
      "https://api-m.sandbox.paypal.com/v2/checkout/orders",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(
            `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`
          ).toString("base64")}`,
        },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            { amount: { currency_code: "EUR", value: totalPrice.toFixed(2) } },
          ],
          application_context: {
            return_url: `${
              process.env.FRONTEND_URL || "http://localhost:5173"
            }/payment?status=success`,
            cancel_url: `${
              process.env.FRONTEND_URL || "http://localhost:5173"
            }/payment?status=cancel`,
          },
        }),
      }
    );

    const data = await response.json();
    
    
    const approvalUrl = data.links?.find(
      (link) => link.rel === "approve"
    )?.href;

    if (!approvalUrl) {
      return res.json({
        result: false,
        error: "Erreur création commande PayPal",
        data,
      });
    }

    res.json({ result: true, orderId: data.id, approvalUrl, totalPrice, paypalOrderId: data.id });
  } catch (err) {
    console.error("Erreur PayPal:", err);
    res.status(500).json({ result: false, error: "Erreur serveur" });
  }
});

export default router;
