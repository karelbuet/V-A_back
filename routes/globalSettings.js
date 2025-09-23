import express from "express";
import GlobalSettings from "../models/globalSettings.js";
import { authenticateToken, requireRole } from "../middleware/auth.js";

const router = express.Router();

// ✅ RÉCUPÉRER - Paramètres globaux (public pour frontend)
router.get("/", async (req, res) => {
  try {
    const settings = await GlobalSettings.find({}).select("-updatedBy");

    // Transformer en objet plus pratique pour le frontend
    const settingsObject = {};
    settings.forEach(setting => {
      settingsObject[setting.settingKey] = setting.settingValue;
    });

    res.json({
      result: true,
      settings: settingsObject,
      rawSettings: settings
    });
  } catch (error) {
    console.error("Erreur récupération paramètres globaux:", error);
    res.status(500).json({
      result: false,
      error: "Erreur récupération paramètres"
    });
  }
});

// ✅ NOUVELLE ROUTE - Récupérer les frais par propriété (pour panier)
router.get("/fees/:property", async (req, res) => {
  try {
    const { property } = req.params;

    // Valider la propriété
    if (!['valery', 'touquet'].includes(property)) {
      return res.status(400).json({
        result: false,
        error: "Propriété invalide. Utilisez 'valery' ou 'touquet'"
      });
    }

    // ✅ CORRECTION - Récupérer les bonnes clés séparées
    const cleaningKey = `cleaning_fee_${property}`;
    const linenKey = `linen_option_price_${property}`;

    // Récupérer les paramètres individuellement
    const [cleaningSetting, linenSetting] = await Promise.all([
      GlobalSettings.findOne({ settingKey: cleaningKey }),
      GlobalSettings.findOne({ settingKey: linenKey })
    ]);

    const cleaningFee = cleaningSetting?.settingValue || 50;
    const linenFee = linenSetting?.settingValue || 50;

    console.log(`🔧 [FEES] ${property}: cleaning=${cleaningFee}, linen=${linenFee}`);

    res.json({
      result: true,
      property,
      fees: {
        cleaning: cleaningFee,
        linen: linenFee
      }
    });

  } catch (error) {
    console.error("Erreur récupération frais propriété:", error);
    res.status(500).json({
      result: false,
      error: "Erreur récupération frais"
    });
  }
});

// ✅ CRÉER/MODIFIER - Paramètre global (admin only)
router.post("/", authenticateToken, requireRole(["admin"]), async (req, res) => {
  try {
    const { settingKey, settingValue, description } = req.body;

    if (!settingKey || settingValue === undefined || !description) {
      return res.status(400).json({
        result: false,
        error: "Paramètres manquants: settingKey, settingValue, description requis"
      });
    }

    // Upsert du paramètre
    const setting = await GlobalSettings.findOneAndUpdate(
      { settingKey },
      {
        settingValue,
        description,
        updatedBy: req.user.userId,
        updatedAt: new Date()
      },
      {
        upsert: true,
        new: true,
        runValidators: true
      }
    );

    res.json({
      result: true,
      setting,
      message: "Paramètre mis à jour avec succès"
    });
  } catch (error) {
    console.error("Erreur mise à jour paramètre global:", error);
    res.status(500).json({
      result: false,
      error: error.message || "Erreur mise à jour paramètre"
    });
  }
});

// ✅ SUPPRIMER - Paramètre global (admin only)
router.delete("/:settingKey", authenticateToken, requireRole(["admin"]), async (req, res) => {
  try {
    const { settingKey } = req.params;

    const deletedSetting = await GlobalSettings.findOneAndDelete({ settingKey });

    if (!deletedSetting) {
      return res.status(404).json({
        result: false,
        error: "Paramètre non trouvé"
      });
    }

    res.json({
      result: true,
      message: "Paramètre supprimé avec succès"
    });
  } catch (error) {
    console.error("Erreur suppression paramètre global:", error);
    res.status(500).json({
      result: false,
      error: "Erreur suppression paramètre"
    });
  }
});

// ✅ RÉCUPÉRER - Paramètres spécifiques à une propriété
router.get("/property/:property", async (req, res) => {
  try {
    const { property } = req.params;

    // Valider la propriété
    if (!["valery", "touquet"].includes(property)) {
      return res.status(400).json({
        result: false,
        error: "Propriété non valide. Utiliser 'valery' ou 'touquet'"
      });
    }

    // Récupérer les paramètres spécifiques à la propriété
    const propertySettings = await GlobalSettings.find({
      settingKey: {
        $in: [
          `cleaning_fee_${property}`,
          `linen_option_price_${property}`,
          `minimum_nights_${property}`,
          `fixed_arrival_days_${property}`,
          `fixed_departure_days_${property}`
        ]
      }
    }).select("-updatedBy");

    // Transformer en objet plus pratique
    const settingsObject = {
      cleaning_fee: 0,
      linen_option_price: 25,
      minimum_nights: 1,
      fixed_arrival_days: [],
      fixed_departure_days: []
    };

    propertySettings.forEach(setting => {
      const key = setting.settingKey.replace(`_${property}`, '');
      settingsObject[key] = setting.settingValue;
    });

    res.json({
      result: true,
      property,
      settings: settingsObject,
      rawSettings: propertySettings
    });
  } catch (error) {
    console.error("Erreur récupération paramètres propriété:", error);
    res.status(500).json({
      result: false,
      error: "Erreur récupération paramètres propriété"
    });
  }
});

// ✅ MODIFIER - Paramètres spécifiques à une propriété (admin only)
router.post("/property/:property", authenticateToken, requireRole(["admin"]), async (req, res) => {
  try {
    const { property } = req.params;
    const { settings } = req.body;

    // Valider la propriété
    if (!["valery", "touquet"].includes(property)) {
      return res.status(400).json({
        result: false,
        error: "Propriété non valide. Utiliser 'valery' ou 'touquet'"
      });
    }

    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({
        result: false,
        error: "Paramètre 'settings' requis et doit être un objet"
      });
    }

    const updatedSettings = [];

    // Mettre à jour chaque paramètre
    for (const [key, value] of Object.entries(settings)) {
      const settingKey = `${key}_${property}`;

      // Descriptions par défaut
      const descriptions = {
        [`cleaning_fee_${property}`]: `Frais de ménage pour ${property}`,
        [`linen_option_price_${property}`]: `Prix option linge pour ${property}`,
        [`minimum_nights_${property}`]: `Nombre minimum de nuits pour ${property}`,
        [`fixed_arrival_days_${property}`]: `Jours d'arrivée autorisés pour ${property}`,
        [`fixed_departure_days_${property}`]: `Jours de départ autorisés pour ${property}`
      };

      const setting = await GlobalSettings.findOneAndUpdate(
        { settingKey },
        {
          settingValue: value,
          description: descriptions[settingKey] || `Paramètre ${key} pour ${property}`,
          updatedBy: req.user.userId,
          updatedAt: new Date()
        },
        {
          upsert: true,
          new: true,
          runValidators: true
        }
      );

      updatedSettings.push(setting);
    }

    res.json({
      result: true,
      property,
      updatedSettings,
      message: `Paramètres mis à jour pour ${property}`
    });
  } catch (error) {
    console.error("Erreur mise à jour paramètres propriété:", error);
    res.status(500).json({
      result: false,
      error: error.message || "Erreur mise à jour paramètres propriété"
    });
  }
});

export default router;