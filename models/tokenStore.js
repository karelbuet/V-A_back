import mongoose from "mongoose";

// Schéma pour les refresh tokens
const refreshTokenSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    required: true,
    index: true
  },
  token: {
    type: String,
    required: true,
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 }
  }
});

// Schéma pour les tokens blacklistés
const blacklistedTokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 }
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    required: true,
    index: true
  }
});

// Index composés pour optimiser les requêtes
refreshTokenSchema.index({ userId: 1, token: 1 });
blacklistedTokenSchema.index({ token: 1, expiresAt: 1 });

const RefreshToken = mongoose.models.RefreshToken || 
  mongoose.model("RefreshToken", refreshTokenSchema);

const BlacklistedToken = mongoose.models.BlacklistedToken || 
  mongoose.model("BlacklistedToken", blacklistedTokenSchema);

export { RefreshToken, BlacklistedToken };