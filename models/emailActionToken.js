import mongoose from 'mongoose';

const emailActionTokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    required: true
  },
  action: {
    type: String,
    enum: ['accept', 'refuse'],
    required: true
  },
  used: {
    type: Boolean,
    default: false
  },
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 jours
    index: { expireAfterSeconds: 0 }
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Index composé pour performance
emailActionTokenSchema.index({ token: 1, used: 1 });
emailActionTokenSchema.index({ bookingId: 1, action: 1 });

const EmailActionToken = mongoose.model('EmailActionToken', emailActionTokenSchema);

export default EmailActionToken;