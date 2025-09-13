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

    // ✅ Essayer plusieurs configurations pour supprimer les cookies
    const isProd = process.env.NODE_ENV === "production";

    // Configuration actuelle (nouvelle)
    const newConfig = {
      httpOnly: true,
      secure: isProd,
      path: "/",
    };

    // Ancienne configuration (au cas où)
    const oldConfig = {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
    };

    // Supprimer avec les deux configurations
    res.clearCookie("accessToken", newConfig);
    res.clearCookie("refreshToken", newConfig);
    res.clearCookie("accessToken", oldConfig);
    res.clearCookie("refreshToken", oldConfig);

    // Force suppression avec configuration basique
    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");

    // Force expiration des cookies
    res.cookie("accessToken", "", { maxAge: 0, httpOnly: true, secure: isProd, path: "/" });
    res.cookie("refreshToken", "", { maxAge: 0, httpOnly: true, secure: isProd, path: "/" });

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