// =======================================
// --- PRICE CACHE SERVICE ---
// =======================================
// Intelligent caching system for price rules with automatic TTL and warmup

import NodeCache from 'node-cache';
import PriceRule from '../models/priceRule.js';

// --- Cache Configuration ---
const CACHE_TTL = 15 * 60; // 15 minutes en secondes
const PRICE_CACHE_KEY = 'price_rules';
const DAILY_PRICE_CACHE_KEY = 'daily_price';

// Instance du cache avec TTL automatique
const cache = new NodeCache({
  stdTTL: CACHE_TTL,
  checkperiod: 60, // Vérification toutes les minutes
  useClones: false // Performance: éviter le clonage profond
});

// --- Price Cache Service Class ---
export class PriceCacheService {
  
  /**
   * Récupère les règles de prix avec cache
   * @param {string} property - Nom de la propriété
   * @returns {Array} Règles de prix
   */
  static async getPriceRules(property) {
    const cacheKey = `${PRICE_CACHE_KEY}_${property}`;
    
    // Vérifier le cache d'abord
    let rules = cache.get(cacheKey);
    if (rules) {
      return rules;
    }
    
    // Cache MISS - récupérer depuis la DB
    try {
      rules = await PriceRule.find({ property })
        .sort({ priority: -1, startDate: 1 })
        .lean(); // Optimisation: objet JS simple, pas de Mongoose Document
      
      // Mettre en cache
      cache.set(cacheKey, rules);
      
      return rules;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Calcule et cache le prix pour une date spécifique
   * @param {string} property - Nom de la propriété
   * @param {string} date - Date au format ISO
   * @returns {Object} Prix calculé avec détails
   */
  static async getPriceForDate(property, date) {
    const cacheKey = `${DAILY_PRICE_CACHE_KEY}_${property}_${date}`;
    
    // Vérifier le cache
    let priceData = cache.get(cacheKey);
    if (priceData) {
      return priceData;
    }
    
    // Cache MISS - calculer le prix
    try {
      const rules = await this.getPriceRules(property);
      const targetDate = new Date(date);
      
      // Trouver la règle applicable (priorité décroissante)
      const applicableRule = rules.find(rule => {
        const start = new Date(rule.startDate);
        const end = new Date(rule.endDate);
        return targetDate >= start && targetDate <= end && rule.isActive;
      });
      
      // Prix par défaut si aucune règle trouvée
      const defaultPrices = {
        "valery-sources-baie": 120,
        "touquet-pinede": 150,
      };

      const priceData = {
        date,
        property,
        price: applicableRule ? applicableRule.pricePerNight : (defaultPrices[property] || 100),
        ruleName: applicableRule ? applicableRule.name : 'Prix par défaut',
        ruleId: applicableRule ? applicableRule._id : null,
        hasRule: !!applicableRule,
        calculatedAt: new Date().toISOString()
      };
      
      // Mettre en cache avec TTL plus court pour les prix quotidiens
      cache.set(cacheKey, priceData, CACHE_TTL / 2); // 7.5 minutes
      
      return priceData;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Invalide le cache pour une propriété spécifique
   * @param {string} property - Nom de la propriété
   */
  static invalidatePriceCache(property) {
    const keys = cache.keys();
    const propertyKeys = keys.filter(key => key.includes(property));
    
    if (propertyKeys.length > 0) {
      cache.del(propertyKeys);
    }
  }

  /**
   * Invalide tout le cache des prix
   */
  static invalidateAllPriceCache() {
    const keys = cache.keys();
    const priceKeys = keys.filter(key => 
      key.includes(PRICE_CACHE_KEY) || key.includes(DAILY_PRICE_CACHE_KEY)
    );
    
    if (priceKeys.length > 0) {
      cache.del(priceKeys);
    }
  }

  /**
   * Préchauffe le cache avec les propriétés courantes
   */
  static async warmupCache() {
    const properties = ['valery-sources-baie', 'touquet-pinede'];
    
    try {
      for (const property of properties) {
        await this.getPriceRules(property);
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Retourne les statistiques du cache
   */
  static getCacheStats() {
    const stats = cache.getStats();
    const keys = cache.keys();
    const priceKeys = keys.filter(key => 
      key.includes(PRICE_CACHE_KEY) || key.includes(DAILY_PRICE_CACHE_KEY)
    );
    
    return {
      ...stats,
      priceEntriesCount: priceKeys.length,
      hitRate: stats.hits / (stats.hits + stats.misses) * 100,
      keys: priceKeys
    };
  }
}

// --- Cache Event Monitoring ---
// Events can be enabled in development by uncommenting:
// cache.on('set', (key, value) => { /* monitoring logic */ });
// cache.on('del', (key, value) => { /* monitoring logic */ });
// cache.on('expired', (key, value) => { /* monitoring logic */ });

export default cache;