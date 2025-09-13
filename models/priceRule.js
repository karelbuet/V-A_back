import mongoose from "mongoose";

const priceRuleSchema = new mongoose.Schema(
  {
    property: {
      type: String,
      required: true,
      enum: ["valery-sources-baie", "touquet-pinede"],
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    pricePerNight: {
      type: Number,
      required: true,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    priority: {
      type: Number,
      default: 0,
    },
    type: {
      type: String,
      enum: ["period"],
      default: "period",
    },
  },
  {
    timestamps: true,
  }
);

priceRuleSchema.index({ property: 1, startDate: 1, endDate: 1 });
priceRuleSchema.index({ property: 1, isActive: 1, priority: -1 });

priceRuleSchema.statics.getPriceForDate = async function (property, date) {
  const targetDate = new Date(date);
  targetDate.setUTCHours(0, 0, 0, 0);

  const rule = await this.findOne({
    property,
    isActive: true,
    type: "period",
    startDate: { $lte: targetDate },
    endDate: { $gte: targetDate },
  }).sort({ priority: -1, createdAt: -1 });

  if (rule) {
    return rule.pricePerNight;
  }

  const defaultPrices = {
    "valery-sources-baie": 120,
    "touquet-pinede": 150,
  };

  return defaultPrices[property] || 100;
};

priceRuleSchema.statics.getPricesForPeriod = async function (
  property,
  startDate,
  endDate
) {
  const prices = {};

  const start = new Date(startDate);
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setUTCHours(0, 0, 0, 0);

  const currentDate = new Date(start);

  while (currentDate <= end) {
    const dateKey = currentDate.toISOString().split("T")[0];
    prices[dateKey] = await this.getPriceForDate(
      property,
      new Date(currentDate)
    );
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  return prices;
};

export default mongoose.model("PriceRule", priceRuleSchema);
