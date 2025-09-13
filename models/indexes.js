import User from './users.js';
import Booking from './booking.js';
import Cart from './cart.js';
import { RefreshToken, BlacklistedToken } from './tokenStore.js';

// Création des index pour optimiser les performances
async function createIndexes() {
  try {
    // Index pour les utilisateurs
    await User.collection.createIndex({ email: 1 }, { unique: true });
    await User.collection.createIndex({ username: 1 }, { sparse: true });
    
    // Index pour les réservations
    await Booking.collection.createIndex({ userId: 1 });
    await Booking.collection.createIndex({ apartmentId: 1 });
    await Booking.collection.createIndex({ startDate: 1, endDate: 1 });
    await Booking.collection.createIndex({ status: 1 });
    
    // Index pour les paniers
    await Cart.collection.createIndex({ userId: 1 }, { unique: true });
    await Cart.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    
    // Index pour les refresh tokens
    await RefreshToken.collection.createIndex({ userId: 1 });
    await RefreshToken.collection.createIndex({ token: 1 });
    await RefreshToken.collection.createIndex({ userId: 1, token: 1 });
    await RefreshToken.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    
    // Index pour les tokens blacklistés
    await BlacklistedToken.collection.createIndex({ token: 1 }, { unique: true });
    await BlacklistedToken.collection.createIndex({ userId: 1 });
    await BlacklistedToken.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    
    console.log('✅ Index MongoDB créés avec succès');
  } catch (error) {
    console.error('❌ Erreur création des index:', error);
  }
}

export default createIndexes;