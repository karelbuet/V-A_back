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
});

bookingSchema.index({ apartmentId: 1, startDate: 1, endDate: 1 });
bookingSchema.index({ userId: 1, status: 1 });
bookingSchema.index({ expiresAt: 1 });

const Booking =
  mongoose.models.Booking || mongoose.model("Booking", bookingSchema);

export default Booking;
