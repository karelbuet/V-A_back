import mongoose from "mongoose";

const connectionString = process.env.CONNECTION_STRING;

if (!connectionString) {
  throw new Error("CONNECTION_STRING non définie dans le .env");
}

try {
  await mongoose.connect(connectionString, { 
    connectTimeoutMS: 2000,
    maxPoolSize: 10,
    bufferCommands: false,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    family: 4 // Force IPv4
  });
  console.log("✅ Database connected");
  
  // Créer les index après connexion
  const createIndexes = (await import('./indexes.js')).default;
  await createIndexes();
} catch (error) {
  console.error("❌ Database connection error:", error);
  process.exit(1);
}
