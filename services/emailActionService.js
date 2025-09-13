import crypto from 'crypto';
import EmailActionToken from '../models/emailActionToken.js';
import Booking from '../models/booking.js';

export class EmailActionService {
  
  /**
   * Génère des tokens sécurisés pour les actions email
   * @param {string} bookingId - ID de la réservation
   * @returns {Object} Tokens pour accepter et refuser
   */
  static async generateActionTokens(bookingId) {
    try {
      // Générer tokens cryptographiquement sécurisés
      const acceptToken = crypto.randomBytes(32).toString('hex');
      const refuseToken = crypto.randomBytes(32).toString('hex');
      
      // Créer les tokens en base
      const tokens = await EmailActionToken.insertMany([
        {
          token: acceptToken,
          bookingId,
          action: 'accept'
        },
        {
          token: refuseToken,
          bookingId,
          action: 'refuse'
        }
      ]);

      return {
        acceptToken,
        refuseToken,
        expiresAt: tokens[0].expiresAt
      };
    } catch (error) {
      console.error('Erreur génération tokens action:', error);
      throw new Error('Impossible de générer les tokens d\'action');
    }
  }

  /**
   * Exécute une action via token email
   * @param {string} token - Token d'action
   * @returns {Object} Résultat de l'action
   */
  static async executeTokenAction(token) {
    try {
      // Trouver le token et vérifier qu'il n'est pas utilisé
      const actionToken = await EmailActionToken.findOne({
        token,
        used: false,
        expiresAt: { $gt: new Date() }
      }).populate({
        path: 'bookingId',
        populate: {
          path: 'userId',
          select: 'firstname lastname email'
        }
      });

      if (!actionToken) {
        return {
          success: false,
          error: 'Token invalide, expiré ou déjà utilisé',
          code: 'INVALID_TOKEN'
        };
      }

      // Vérifier que la réservation existe et est en attente
      if (!actionToken.bookingId) {
        return {
          success: false,
          error: 'Réservation introuvable',
          code: 'BOOKING_NOT_FOUND'
        };
      }

      if (actionToken.bookingId.status !== 'pending') {
        return {
          success: false,
          error: 'Cette réservation a déjà été traitée',
          code: 'ALREADY_PROCESSED'
        };
      }

      // Exécuter l'action
      const newStatus = actionToken.action === 'accept' ? 'accepted' : 'refused';
      
      // Mettre à jour la réservation et marquer le token comme utilisé
      await Promise.all([
        Booking.findByIdAndUpdate(actionToken.bookingId._id, { 
          status: newStatus,
          processedAt: new Date()
        }),
        EmailActionToken.findByIdAndUpdate(actionToken._id, { 
          used: true,
          usedAt: new Date()
        })
      ]);

      // Log pour audit
      console.log(`Action email exécutée: ${actionToken.action} pour réservation ${actionToken.bookingId._id}`);

      return {
        success: true,
        action: actionToken.action,
        booking: {
          id: actionToken.bookingId._id,
          apartmentId: actionToken.bookingId.apartmentId,
          startDate: actionToken.bookingId.startDate,
          endDate: actionToken.bookingId.endDate,
          price: actionToken.bookingId.price,
          status: newStatus,
          user: actionToken.bookingId.userId
        }
      };

    } catch (error) {
      console.error('Erreur exécution action token:', error);
      throw new Error('Erreur lors de l\'exécution de l\'action');
    }
  }

  /**
   * Nettoie les tokens expirés (maintenance)
   */
  static async cleanupExpiredTokens() {
    try {
      const result = await EmailActionToken.deleteMany({
        $or: [
          { expiresAt: { $lt: new Date() } },
          { used: true, usedAt: { $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } // 30 jours
        ]
      });
      
      if (result.deletedCount > 0) {
        console.log(`🧹 Nettoyage tokens email: ${result.deletedCount} tokens supprimés`);
      }
      
      return result.deletedCount;
    } catch (error) {
      console.error('Erreur nettoyage tokens:', error);
    }
  }
}