import express from "express";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

// Route pour vérifier les informations du token actuel
router.get("/info", authenticateToken, (req, res) => {
  try {
    const now = Math.floor(Date.now() / 1000);
    const timeUntilExpiry = req.user.exp - now;
    const expiresInMinutes = Math.floor(timeUntilExpiry / 60);
    const expiresInSeconds = timeUntilExpiry % 60;

    res.json({
      result: true,
      tokenInfo: {
        userId: req.user.userId,
        email: req.user.email,
        role: req.user.role,
        issuedAt: new Date(req.user.iat * 1000).toISOString(),
        expiresAt: new Date(req.user.exp * 1000).toISOString(),
        timeUntilExpiry: {
          totalSeconds: timeUntilExpiry,
          minutes: expiresInMinutes,
          seconds: expiresInSeconds,
          formatted: `${expiresInMinutes}m ${expiresInSeconds}s`
        },
        shouldRenew: req.user.shouldRenew || false
      }
    });
  } catch (error) {
    res.status(500).json({
      result: false,
      error: "Erreur lors de la récupération des informations du token"
    });
  }
});

export default router;