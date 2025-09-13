import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import "../models/connection.js";
import Comment from "../models/comments.js";
import Booking from "../models/booking.js";
import { authorizeRoles } from "../modules/authorizeRoles.js";

const router = express.Router();

// Ajouter un commentaire pour une réservation
router.post("/", authenticateToken, async (req, res) => {
  try {
    const { bookingId, commentaire, rating, nom, ville, pays } = req.body;
    const userId = req.user.userId; // Utiliser userId du token JWT

    // Validation des champs requis
    if (!bookingId || !commentaire || !rating) {
      return res.status(400).json({
        result: false,
        error: "Réservation, commentaire et note requis",
      });
    }

    // Validation de la note
    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        result: false,
        error: "La note doit être entre 1 et 5",
      });
    }

    // Vérifie que la réservation existe et appartient à l'utilisateur
    const booking = await Booking.findOne({
      _id: bookingId,
      userId: userId,
      status: "confirmed", // Seules les réservations confirmées peuvent avoir un commentaire
    });

    if (!booking) {
      return res.status(404).json({
        result: false,
        error: "Réservation non trouvée ou non autorisée",
      });
    }

    // Vérifier qu'un commentaire n'existe pas déjà pour cette réservation
    const existingComment = await Comment.findOne({ bookingId });
    if (existingComment) {
      return res.status(400).json({
        result: false,
        error: "Un commentaire existe déjà pour cette réservation",
      });
    }

    // Créer le commentaire
    const newComment = new Comment({
      userId,
      bookingId,
      apartmentName: booking.apartmentId, // Utiliser l'apartmentId de la réservation
      commentaire,
      rating,
      nom,
      ville,
      pays,
      reservationDate: booking.startDate,
    });

    const savedComment = await newComment.save();
    await savedComment.populate("userId");

    res.json({
      result: true,
      comment: savedComment,
      message: "Commentaire ajouté avec succès",
    });
  } catch (err) {
    console.error("Error adding comment:", err);
    res.status(500).json({ result: false, error: err.message });
  }
});

// Récupérer tous les commentaires avec pagination
router.get("/", async (req, res) => {
  try {
    // Paramètres de pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20; // ✅ CORRECTION - Par défaut 20 comme le frontend
    const skip = (page - 1) * limit;

    // Validation des paramètres
    if (page < 1 || limit < 1 || limit > 50) {
      return res.status(400).json({
        result: false,
        error: "Paramètres de pagination invalides (page >= 1, limit 1-50)",
      });
    }

    // ✅ CORRECTION - Requêtes parallèles pour performance + calcul moyenne globale
    const [comments, totalCount, avgRatingAgg] = await Promise.all([
      Comment.find()
        .populate("userId", "name") // Seulement le nom de l'utilisateur
        .select(
          "commentaire rating apartmentName nom ville pays createdAt date"
        ) // Champs publics + date
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(), // Performance: objet JS simple
      Comment.countDocuments(),
      // ✅ NOUVEAU - Calcul de la moyenne sur TOUS les commentaires
      Comment.aggregate([
        { $group: { _id: null, avgRating: { $avg: "$rating" } } },
      ])
    ]);

    // Normalisation : displayDate = createdAt si existe, sinon date
    const commentsWithDisplayDate = comments.map((c) => ({
      ...c,
      displayDate: c.createdAt || c.date,
    }));

    // ✅ CORRECTION - Note moyenne calculée sur tous les commentaires
    const averageRating = avgRatingAgg.length > 0 ? avgRatingAgg[0].avgRating : 0;

    // Métadonnées de pagination
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    res.json({
      result: true,
      comments: commentsWithDisplayDate,
      // ✅ NOUVEAU - Données globales pour les statistiques
      averageRating: Math.round(averageRating * 10) / 10, // Arrondi à 1 décimale
      totalComments: totalCount, // Nombre total de commentaires
      pagination: {
        currentPage: page,
        totalPages,
        totalItems: totalCount,
        itemsPerPage: limit,
        hasNextPage,
        hasPrevPage,
        nextPage: hasNextPage ? page + 1 : null,
        prevPage: hasPrevPage ? page - 1 : null,
      },
    });
  } catch (err) {
    console.error("Error fetching comments:", err);
    res.status(500).json({ result: false, error: err.message });
  }
});

// Récupérer les commentaires d'un appartement spécifique
router.get("/apartment/:apartmentName", async (req, res) => {
  try {
    // Paramètres de pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20; // ✅ CORRECTION - Par défaut 20 comme le frontend
    const skip = (page - 1) * limit;

    // Validation des paramètres
    if (page < 1 || limit < 1 || limit > 50) {
      return res.status(400).json({
        result: false,
        error: "Paramètres de pagination invalides (page >= 1, limit 1-50)",
      });
    }

    const apartmentName = decodeURIComponent(req.params.apartmentName);

    // ✅ CORRECTION - Requêtes parallèles pour performance + calcul moyenne sur TOUS les commentaires de l'appartement
    const [comments, totalCount, avgRatingAgg] = await Promise.all([
      Comment.find({ apartmentName })
        .populate("userId", "name")
        .select("commentaire rating nom ville pays createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Comment.countDocuments({ apartmentName }),
      // ✅ NOUVEAU - Calcul de la moyenne sur TOUS les commentaires de cet appartement
      Comment.aggregate([
        { $match: { apartmentName } },
        { $group: { _id: null, avgRating: { $avg: "$rating" } } },
      ])
    ]);

    // ✅ CORRECTION - Utilise la variable correcte du Promise.all
    const avgRating =
      avgRatingAgg.length > 0 ? avgRatingAgg[0].avgRating : 0;

    // Métadonnées de pagination
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    res.json({
      result: true,
      apartmentName,
      averageRating: Math.round(avgRating * 10) / 10, // Arrondi à 1 décimale
      totalComments: totalCount,
      comments,
      pagination: {
        currentPage: page,
        totalPages,
        totalItems: totalCount,
        itemsPerPage: limit,
        hasNextPage,
        hasPrevPage,
        nextPage: hasNextPage ? page + 1 : null,
        prevPage: hasPrevPage ? page - 1 : null,
      },
    });
  } catch (err) {
    console.error("Error fetching comments by apartment:", err);
    res.status(500).json({ result: false, error: err.message });
  }
});

// Vérifier si l'utilisateur peut commenter une réservation
router.get("/can-comment/:bookingId", authenticateToken, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.userId;

    // Vérifier la réservation
    const booking = await Booking.findOne({
      _id: bookingId,
      userId: userId,
      status: "confirmed",
    });

    if (!booking) {
      return res.json({
        result: false,
        canComment: false,
        reason: "Réservation non trouvée ou non autorisée",
      });
    }

    // Vérifier qu'il n'y a pas déjà un commentaire
    const existingComment = await Comment.findOne({ bookingId });
    if (existingComment) {
      return res.json({
        result: true,
        canComment: false,
        reason: "Commentaire déjà existant",
        comment: existingComment,
      });
    }

    res.json({
      result: true,
      canComment: true,
      booking: {
        _id: booking._id,
        apartmentId: booking.apartmentId,
        startDate: booking.startDate,
        endDate: booking.endDate,
      },
    });
  } catch (err) {
    console.error("Error checking comment eligibility:", err);
    res.status(500).json({ result: false, error: err.message });
  }
});

// -------------------------
// DELETE /comments/:id : supprimer un commentaire
// -------------------------
router.delete(
  "/:id",
  authenticateToken,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const deleted = await Comment.findByIdAndDelete(req.params.id);

      if (!deleted) {
        return res
          .status(404)
          .json({ result: false, error: "Comment not found" });
      }

      // Supprime la référence du commentaire dans les lieux si nécessaire
      // await Place.updateMany(
      //   { comments: req.params.id },
      //   { $pull: { comments: req.params.id } }
      // );

      res.json({ result: true, message: "Comment deleted" });
    } catch (err) {
      console.error("Error deleting comment:", err);
      res.status(500).json({ result: false, error: err.message });
    }
  }
);

export default router;
