import mongoose from "mongoose";

const globalSettingsSchema = new mongoose.Schema({
  // Paramètres système
  settingKey: {
    type: String,
    required: true,
    unique: true,
    enum: [
      "cleaning_fee",
      "linen_option_price",
      "minimum_nights_default",
      "payment_rules",
      "booking_settings",
      "cleaning_fee_valery",
      "cleaning_fee_touquet",
      "linen_option_price_valery",
      "linen_option_price_touquet",
      "minimum_nights_valery",
      "minimum_nights_touquet",
      "fixed_arrival_days_valery",
      "fixed_arrival_days_touquet",
      "fixed_departure_days_valery",
      "fixed_departure_days_touquet"
    ]
  },
  settingValue: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    required: false
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Index pour performance
globalSettingsSchema.index({ settingKey: 1 });

const GlobalSettings = mongoose.models.GlobalSettings || mongoose.model("GlobalSettings", globalSettingsSchema);

export default GlobalSettings;