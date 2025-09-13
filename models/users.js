import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  email: { type: String, required: true },
  lastname: { type: String, required: true },
  firstname: { type: String, required: true },
  password: { type: String, required: true },
  username: String,
  phone: String,
  role: { type: String, enum: ["user", "admin"], default: "user" },
});

const User = mongoose.models.users || mongoose.model("users", userSchema);

export default User;
