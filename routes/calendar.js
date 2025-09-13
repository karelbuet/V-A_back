import express from "express";
import BlockedDate from "../models/calendar.js";
import { authenticateToken } from "../middleware/auth.js";
import Booking from "../models/booking.js";
import PriceRule from "../models/priceRule.js";

const router = express.Router();

// 👉 Bloquer dates
router.post("/blockDates", authenticateToken, async (req, res) => {
  const { apartmentId, startDate, endDate, reason } = req.body;

  try {
    // Vérifier si les dates se chevauchent avec des périodes existantes
    const existingBlocks = await BlockedDate.find({
      apartmentId,
      $or: [
        {
          $and: [
            { startDate: { $lte: new Date(startDate) } },
            { endDate: { $gte: new Date(startDate) } },
          ],
        },
        {
          $and: [
            { startDate: { $lte: new Date(endDate) } },
            { endDate: { $gte: new Date(endDate) } },
          ],
        },
        {
          $and: [
            { startDate: { $gte: new Date(startDate) } },
            { endDate: { $lte: new Date(endDate) } },
          ],
        },
      ],
    });

    if (existingBlocks.length > 0) {
      return res.json({
        result: false,
        error: "Cette période chevauche avec des dates déjà bloquées",
      });
    }

    const blocked = new BlockedDate({
      apartmentId,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      reason: reason || "Non spécifié",
    });

    await blocked.save();
    res.json({ result: true, data: blocked });
  } catch (err) {
    res.json({ result: false, error: err.message });
  }
});

// 👉 Débloquer dates - Version améliorée pour gérer les chevauchements
router.delete("/unblockDates", authenticateToken, async (req, res) => {
  const { apartmentId, startDate, endDate } = req.body;

  try {
    const unblockStart = new Date(startDate);
    const unblockEnd = new Date(endDate);

    // Trouver toutes les périodes bloquées qui chevauchent avec la période à débloquer
    const overlappingPeriods = await BlockedDate.find({
      apartmentId,
      $or: [
        // Période complètement incluse dans la période à débloquer
        {
          $and: [
            { startDate: { $gte: unblockStart } },
            { endDate: { $lte: unblockEnd } },
          ],
        },
        // Période qui englobe complètement la période à débloquer
        {
          $and: [
            { startDate: { $lte: unblockStart } },
            { endDate: { $gte: unblockEnd } },
          ],
        },
        // Chevauchement partiel - début de la période dans la zone à débloquer
        {
          $and: [
            { startDate: { $lte: unblockEnd } },
            { startDate: { $gte: unblockStart } },
            { endDate: { $gt: unblockEnd } },
          ],
        },
        // Chevauchement partiel - fin de la période dans la zone à débloquer
        {
          $and: [
            { endDate: { $gte: unblockStart } },
            { endDate: { $lte: unblockEnd } },
            { startDate: { $lt: unblockStart } },
          ],
        },
      ],
    });

    if (overlappingPeriods.length === 0) {
      return res.json({
        result: false,
        error: "Aucune période bloquée trouvée dans cette plage de dates",
      });
    }

    let deletedCount = 0;
    let createdCount = 0;

    // Traiter chaque période chevauchante
    for (const period of overlappingPeriods) {
      const periodStart = new Date(period.startDate);
      const periodEnd = new Date(period.endDate);

      // Supprimer la période existante
      await BlockedDate.findByIdAndDelete(period._id);
      deletedCount++;

      // Créer les parties qui restent bloquées

      // Partie avant (si la période bloquée commence avant la zone à débloquer)
      if (periodStart < unblockStart) {
        const beforeEnd = new Date(unblockStart);
        beforeEnd.setDate(beforeEnd.getDate() - 1);

        await new BlockedDate({
          apartmentId,
          startDate: periodStart,
          endDate: beforeEnd,
          reason: period.reason,
        }).save();
        createdCount++;
      }

      // Partie après (si la période bloquée finit après la zone à débloquer)
      if (periodEnd > unblockEnd) {
        const afterStart = new Date(unblockEnd);
        afterStart.setDate(afterStart.getDate() + 1);

        await new BlockedDate({
          apartmentId,
          startDate: afterStart,
          endDate: periodEnd,
          reason: period.reason,
        }).save();
        createdCount++;
      }
    }

    res.json({
      result: true,
      message: `Déblocage effectué : ${deletedCount} période(s) supprimée(s), ${createdCount} nouvelle(s) période(s) créée(s)`,
      deletedCount,
      createdCount,
    });
  } catch (err) {
    res.json({ result: false, error: err.message });
  }
});

// 👉 Débloquer une période spécifique par ID
router.delete("/unblockPeriod/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await BlockedDate.findByIdAndDelete(id);

    if (!result) {
      return res.json({
        result: false,
        error: "Période non trouvée",
      });
    }

    res.json({ result: true, message: "Période débloquée avec succès" });
  } catch (err) {
    res.json({ result: false, error: err.message });
  }
});

// 👉 Récupérer les dates bloquées
router.get("/blockedDates", authenticateToken, async (req, res) => {
  const { apartmentId } = req.query;

  if (!apartmentId) {
    return res.json({ result: false, error: "apartmentId requis" });
  }

  try {
    const blockedDates = await BlockedDate.find({ apartmentId }).sort({
      startDate: 1,
    }); // Trier par date de début croissante

    res.json({ result: true, blockedDates });
  } catch (err) {
    res.json({ result: false, error: err.message });
  }
});

// 👉 Vérifier la disponibilité d'une période
router.post("/checkAvailability", authenticateToken, async (req, res) => {
  const { apartmentId, startDate, endDate } = req.body;

  try {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // ✅ CORRECTION - Vérifier les dates bloquées ET toutes les réservations actives
    const [blockedConflicts, bookingConflicts] = await Promise.all([
      BlockedDate.find({
        apartmentId,
        $or: [
          { startDate: { $lte: end }, endDate: { $gte: start } }
        ],
      }),
      Booking.find({
        apartmentId,
        status: { $in: ["pending", "accepted", "confirmed"] }, // Bloquer pending, accepted et confirmed
        $or: [
          { startDate: { $lte: end }, endDate: { $gte: start } }
        ],
      })
    ]);

    const allConflicts = [...blockedConflicts, ...bookingConflicts];

    res.json({
      result: true,
      available: allConflicts.length === 0,
      conflicts: allConflicts,
      blockedDates: blockedConflicts,
      bookings: bookingConflicts
    });
  } catch (err) {
    res.json({ result: false, error: err.message });
  }
});

// 👉 Route optimisée pour récupérer toutes les dates désactivées
router.get("/disabledDates", async (req, res) => {
  const { apartmentId } = req.query;

  if (!apartmentId) {
    return res.json({ result: false, error: "apartmentId requis" });
  }

  try {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    // Requêtes parallèles optimisées avec sélection des champs nécessaires
    const [blockedDates, bookings] = await Promise.all([
      BlockedDate.find({ 
        apartmentId,
        endDate: { $gte: now } // Seulement les dates futures
      })
      .select('startDate endDate reason')
      .sort({ startDate: 1 })
      .lean(), // Plus rapide pour lecture seule

      Booking.find({
        apartmentId,
        status: { $in: ["pending", "accepted", "confirmed"] }, // ✅ CORRECTION - Inclure toutes les réservations actives
        endDate: { $gte: now } // Seulement les réservations futures
      })
      .select('startDate endDate status') // Inclure le statut pour debug
      .sort({ startDate: 1 })
      .lean()
    ]);

    // Générer un tableau de toutes les dates désactivées individuelles
    const disabledDates = [];
    const departureDates = new Set(); // Jours de départ (disponibles pour arrivée)
    
    // Ajouter les dates bloquées par l'admin (bloquées complètement)
    blockedDates.forEach(period => {
      // ✅ CORRECTION - Extraire directement la date UTC comme date logique
      const start = new Date(period.startDate);
      const end = new Date(period.endDate);

      // Extraire la partie date UTC
      const startDateStr = start.toISOString().split('T')[0];
      const endDateStr = end.toISOString().split('T')[0];

      // Bloquer toutes les dates de la période (inclut début et fin)
      const currentDate = new Date(startDateStr + 'T00:00:00.000Z');
      const finalDate = new Date(endDateStr + 'T00:00:00.000Z');

      for (let date = new Date(currentDate); date <= finalDate; date.setDate(date.getDate() + 1)) {
        disabledDates.push(date.toISOString().split('T')[0]);
      }
    });

    // Ajouter les dates de réservations (SAUF le jour de départ)
    bookings.forEach(booking => {
      // ✅ CORRECTION - Extraire directement la date UTC comme date logique du séjour
      const start = new Date(booking.startDate);
      const end = new Date(booking.endDate);

      // Extraire la partie date UTC (représente la date logique du séjour)
      const startDateStr = start.toISOString().split('T')[0]; // Ex: "2025-09-21"
      const endDateStr = end.toISOString().split('T')[0];     // Ex: "2025-09-26"

      // Le jour de départ est disponible pour nouvelle arrivée
      departureDates.add(endDateStr);

      // Bloquer du jour d'arrivée jusqu'à la veille du départ
      const currentDate = new Date(startDateStr + 'T00:00:00.000Z');
      const finalDate = new Date(endDateStr + 'T00:00:00.000Z');

      for (let date = new Date(currentDate); date < finalDate; date.setDate(date.getDate() + 1)) {
        disabledDates.push(date.toISOString().split('T')[0]);
      }
    });

    // Supprimer les doublons et trier
    const uniqueDisabledDates = [...new Set(disabledDates)].sort();
    const availableDepartureDates = [...departureDates].sort();

    res.json({
      result: true,
      disabledDates: uniqueDisabledDates,
      availableDepartureDates,
      periodsData: {
        blockedDates,
        bookings
      }
    });
  } catch (err) {
    console.error("❌ Erreur disabledDates:", err);
    res.json({ result: false, error: err.message });
  }
});

// 👉 Route pour récupérer les prix par période
router.get("/prices", async (req, res) => {
  const { apartmentId, startDate, endDate } = req.query;

  if (!apartmentId || !startDate || !endDate) {
    return res.json({ 
      result: false, 
      error: "apartmentId, startDate et endDate requis" 
    });
  }

  try {
    // Mappage des apartmentId vers les property names
    const propertyMap = {
      'valery-sources-baie': 'valery-sources-baie',
      'touquet-pinede': 'touquet-pinede'
    };

    const property = propertyMap[apartmentId];
    if (!property) {
      return res.json({ result: false, error: "Appartement non reconnu" });
    }

    // Normaliser les dates reçues en format ISO (YYYY-MM-DD)
    const normalizedStartDate = new Date(startDate + 'T00:00:00.000Z');
    const normalizedEndDate = new Date(endDate + 'T00:00:00.000Z');

    const prices = await PriceRule.getPricesForPeriod(property, normalizedStartDate, normalizedEndDate);
    
    // Calculer le prix total
    const totalPrice = Object.values(prices).reduce((sum, price) => sum + price, 0);
    
    res.json({
      result: true,
      property,
      startDate,
      endDate,
      dailyPrices: prices,
      totalPrice,
      numberOfNights: Object.keys(prices).length
    });
  } catch (err) {
    console.error("❌ Erreur récupération prix:", err);
    res.json({ result: false, error: err.message });
  }
});

// 👉 Route pour récupérer le prix d'une date spécifique
router.get("/price/:apartmentId/:date", async (req, res) => {
  const { apartmentId, date } = req.params;

  try {
    const propertyMap = {
      'valery-sources-baie': 'valery-sources-baie',
      'touquet-pinede': 'touquet-pinede'
    };

    const property = propertyMap[apartmentId];
    if (!property) {
      return res.json({ result: false, error: "Appartement non reconnu" });
    }

    // Normaliser la date reçue en format ISO (YYYY-MM-DD)
    const normalizedDate = new Date(date + 'T00:00:00.000Z');
    const price = await PriceRule.getPriceForDate(property, normalizedDate);
    
    res.json({
      result: true,
      property,
      date,
      price
    });
  } catch (err) {
    console.error("❌ Erreur récupération prix:", err);
    res.json({ result: false, error: err.message });
  }
});

export default router;
