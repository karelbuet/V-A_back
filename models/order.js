import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema({
  apartmentId: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  price: { type: Number, required: true },
});

const orderSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    required: true,
  },
  items: [orderItemSchema],
  totalPrice: { type: Number, required: true },
  status: {
    type: String,
    enum: [
      "pending_payment", // En attente de paiement
      "completed", // Commande terminée
      "failed", // Échec (problème de disponibilité)
      "expired", // Expirée (pas payée à temps)
      "cancelled", // Annulée par l'utilisateur
    ],
    default: "pending_payment",
  },
  paymentId: { type: String }, // ID du paiement (Stripe, PayPal, etc.)
  paymentDetails: { type: Object }, // Détails du paiement
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  completedAt: { type: Date },
  cancelledAt: { type: Date },
});

// Index pour améliorer les performances
orderSchema.index({ userId: 1, status: 1 });
orderSchema.index({ expiresAt: 1 });

const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);

export default Order;
