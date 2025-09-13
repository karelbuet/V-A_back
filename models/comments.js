import mongoose from "mongoose";

// Commentaires pour réservations avec rating
const commentSchema = new mongoose.Schema(
  {
    // Référence à l'utilisateur
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    // Référence à la réservation
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
    },
    // Nom du logement
    apartmentName: {
      type: String,
      required: true,
    },
    // Commentaire de l'utilisateur
    commentaire: {
      type: String,
      required: true,
      maxlength: 1000,
    },
    // Note sur 5 étoiles
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    // Informations optionnelles
    nom: { type: String },
    ville: { type: String },
    pays: { type: String },
    // Date de la réservation (pour référence)
    reservationDate: { type: Date },
  },
  {
    timestamps: true, // createdAt et updatedAt automatiques
  }
);

// Index pour optimiser les requêtes
commentSchema.index({ apartmentName: 1, createdAt: -1 });
commentSchema.index({ userId: 1 });
commentSchema.index({ bookingId: 1 }, { unique: true }); // Un commentaire par réservation

const Comment = mongoose.model("comments", commentSchema);

export default Comment;
