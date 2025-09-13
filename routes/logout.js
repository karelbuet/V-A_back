import express from "express";
import { authenticateToken, SecureAuthService } from "../middleware/auth.js";

const router = express.Router();

// -------------------------
// Déconnexion de l'utilisateur
// -------------------------
router.post("/logout", authenticateToken, async (req, res) => {
  try {
    const token = req.cookies?.accessToken;
    const userId = req.user?.userId;

    // Révoquer les tokens côté serveur
    try {
      if (token && userId) {
        await SecureAuthService.revokeToken(token, userId);
      }
      if (userId) {
        await SecureAuthService.revokeUserTokens(userId);
      }
    } catch (revokeError) {
      console.error("Erreur révocation tokens logout:", revokeError);
      // Continue le logout même si la révocation échoue
    }

    // ✅ Supprimer les cookies avec la même config que lors de la création
    const isProd = process.env.NODE_ENV === "production";
    const clearConfig = {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      domain: isProd ? process.env.COOKIE_DOMAIN : undefined,
      path: "/",
    };
    
    res.clearCookie("accessToken", clearConfig);
    res.clearCookie("refreshToken", clearConfig);

    res.json({
      result: true,
      message: "Déconnexion réussie",
    });
  } catch (err) {
    console.error("Erreur logout:", err);
    res.status(500).json({ result: false, error: "Erreur serveur" });
  }
});

export default router;