import mongoose from "mongoose";

const blockedDateSchema = new mongoose.Schema({
  apartmentId: String,
  startDate: Date,
  endDate: Date,
  reason: String,
});
const BlockedDate = mongoose.model("BlockedDate", blockedDateSchema);

export default BlockedDate;
