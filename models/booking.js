import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    required: true,
  },
  apartmentId: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  price: { type: Number, required: true },
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Order",
  },
  status: {
    type: String,
    enum: [
      "pending",
      "accepted",
      "refused",
      "confirmed",
      "temporary",
      "cancelled",
    ],
    default: "pending",
  },
  bookedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date },

  // Guest details
  guestDetails: {
    adults: {
      type: Number,
      default: 1,
      min: 1,
      max: 20
    },
    children: [{
      age: {
        type: Number,
        min: 0,
        max: 17
      }
    }],
    pets: [{
      type: {
        type: String,
        trim: true
      },
      size: {
        type: String,
        trim: true,
        enum: ["petit", "moyen", "grand"]
      }
    }],
    specialRequests: {
      type: String,
      trim: true,
      maxlength: 1000
    },
    arrivalTime: {
      type: String,
      trim: true
    },
    contactPhone: {
      type: String,
      trim: true
    },
    reason: {
      type: String,
      trim: true
    }
  },

  // Services additionnels
  additionalServices: {
    cleaning: {
      included: {
        type: Boolean,
        default: false
      },
      price: {
        type: Number,
        default: 0
      }
    },
    linen: {
      included: {
        type: Boolean,
        default: false
      },
      price: {
        type: Number,
        default: 0
      }
    }
  },

  // Prix ajusté avec services
  totalPrice: {
    type: Number,
    required: true
  }
});

bookingSchema.index({ apartmentId: 1, startDate: 1, endDate: 1 });
bookingSchema.index({ userId: 1, status: 1 });
bookingSchema.index({ expiresAt: 1 });

const Booking =
  mongoose.models.Booking || mongoose.model("Booking", bookingSchema);

export default Booking;
