import express from 'express';
import PriceRule from '../models/priceRule.js';
import { authenticateToken as auth } from '../middleware/auth.js';
import { PriceCacheService } from '../services/priceCache.js';

const router = express.Router();

// GET - Récupérer toutes les règles de prix pour une propriété (avec cache)
router.get('/:property', auth, async (req, res) => {
  try {
    const { property } = req.params;
    
    if (!['valery-sources-baie', 'touquet-pinede'].includes(property)) {
      return res.status(400).json({ message: 'Propriété invalide' });
    }
    
    // Utilisation du cache pour améliorer les performances
    const rules = await PriceCacheService.getPriceRules(property);
    
    res.json(rules);
  } catch (error) {
    console.error('Erreur récupération règles de prix:', error);
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
});

// GET - Récupérer le prix pour une date spécifique (avec cache)
router.get('/:property/date/:date', async (req, res) => {
  try {
    const { property, date } = req.params;
    
    if (!['valery-sources-baie', 'touquet-pinede'].includes(property)) {
      return res.status(400).json({ message: 'Propriété invalide' });
    }
    
    // Utilisation du cache pour les calculs de prix
    const priceData = await PriceCacheService.getPriceForDate(property, date);
    res.json(priceData);
  } catch (error) {
    console.error('Erreur calcul prix pour date:', error);
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
});

// GET - Récupérer les prix pour une période
router.get('/:property/period/:startDate/:endDate', async (req, res) => {
  try {
    const { property, startDate, endDate } = req.params;
    
    if (!['valery-sources-baie', 'touquet-pinede'].includes(property)) {
      return res.status(400).json({ message: 'Propriété invalide' });
    }
    
    const prices = await PriceRule.getPricesForPeriod(property, startDate, endDate);
    res.json({ property, startDate, endDate, prices });
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
});

// POST - Créer une nouvelle règle de prix
router.post('/', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Accès non autorisé' });
    }
    
    const {
      property,
      name,
      startDate,
      endDate,
      pricePerNight,
      priority
    } = req.body;
    
    // Validation des champs requis
    if (!property || !name || !startDate || !endDate || !pricePerNight) {
      return res.status(400).json({ 
        message: 'Champs requis: property, name, startDate, endDate, pricePerNight' 
      });
    }
    
    // Vérifier les dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (start >= end) {
      return res.status(400).json({ 
        message: 'La date de fin doit être postérieure à la date de début' 
      });
    }
    
    // Vérifier les conflits de dates pour les règles de période
    const conflictingRules = await PriceRule.find({
      property,
      isActive: true,
      $or: [
        {
          startDate: { $lte: end },
          endDate: { $gte: start }
        }
      ]
    });
    
    if (conflictingRules.length > 0) {
      return res.status(409).json({ 
        message: 'Conflit détecté avec une règle existante',
        conflictingRules 
      });
    }
    
    const priceRule = new PriceRule({
      property,
      name,
      startDate: start,
      endDate: end,
      pricePerNight: Number(pricePerNight),
      priority: priority || 0,
      type: 'period'
    });
    
    await priceRule.save();
    
    // Invalider le cache après création
    PriceCacheService.invalidatePriceCache(property);
    
    res.status(201).json(priceRule);
  } catch (error) {
    console.error('Erreur création règle de prix:', error);
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
});

// PUT - Modifier une règle de prix
router.put('/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Accès non autorisé' });
    }
    
    const { id } = req.params;
    const updates = req.body;
    
    // Validation des dates si modifiées
    if (updates.startDate && updates.endDate) {
      const start = new Date(updates.startDate);
      const end = new Date(updates.endDate);
      
      if (start >= end) {
        return res.status(400).json({ 
          message: 'La date de fin doit être postérieure à la date de début' 
        });
      }
    }
    
    const priceRule = await PriceRule.findByIdAndUpdate(
      id,
      { ...updates, updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    
    if (!priceRule) {
      return res.status(404).json({ message: 'Règle de prix non trouvée' });
    }
    
    // Invalider le cache après modification
    PriceCacheService.invalidatePriceCache(priceRule.property);
    
    res.json(priceRule);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
});

// DELETE - Supprimer une règle de prix
router.delete('/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Accès non autorisé' });
    }
    
    const { id } = req.params;
    const priceRule = await PriceRule.findByIdAndDelete(id);
    
    if (!priceRule) {
      return res.status(404).json({ message: 'Règle de prix non trouvée' });
    }
    
    // Invalider le cache après suppression
    PriceCacheService.invalidatePriceCache(priceRule.property);
    
    res.json({ message: 'Règle de prix supprimée avec succès' });
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
});

// PATCH - Activer/désactiver une règle de prix
router.patch('/:id/toggle', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Accès non autorisé' });
    }
    
    const { id } = req.params;
    const priceRule = await PriceRule.findById(id);
    
    if (!priceRule) {
      return res.status(404).json({ message: 'Règle de prix non trouvée' });
    }
    
    priceRule.isActive = !priceRule.isActive;
    await priceRule.save();
    
    // Invalider le cache après modification du statut
    PriceCacheService.invalidatePriceCache(priceRule.property);
    
    res.json(priceRule);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
});

export default router;