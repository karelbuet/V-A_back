// ===========================================
// --- JWT AUTHENTICATION MIDDLEWARE ---
// ===========================================
// Secure JWT implementation with automatic token refresh and blacklist support

import jwt from "jsonwebtoken";
import crypto from "crypto";
import { RefreshToken, BlacklistedToken } from "../models/tokenStore.js";

// --- JWT Configuration & Security Validation ---
const JWT_SECRET = process.env.SECRET_KEY;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

// Validation des secrets au démarrage
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error(
    "SECRET_KEY manquant ou trop faible. Utilisez au minimum 32 caractères aléatoires."
  );
}

if (!JWT_REFRESH_SECRET || JWT_REFRESH_SECRET.length < 32) {
  throw new Error(
    "JWT_REFRESH_SECRET manquant ou trop faible. Utilisez au minimum 32 caractères aléatoires."
  );
}

if (JWT_SECRET === JWT_REFRESH_SECRET) {
  throw new Error("SECRET_KEY et JWT_REFRESH_SECRET doivent être différents.");
}

const JWT_EXPIRES_IN = "1h"; // Token valide 1 heure
const JWT_REFRESH_EXPIRES_IN = "7d";

// --- Secure Authentication Service Class ---
export class SecureAuthService {
  static async generateTokens(user) {
    try {
      const payload = {
        userId: user._id,
        email: user.email,
        role: user.role,
        iat: Math.floor(Date.now() / 1000),
      };

      const accessToken = jwt.sign(payload, JWT_SECRET, {
        expiresIn: JWT_EXPIRES_IN,
        issuer: "immova-api",
        audience: "immova-client",
      });

      const refreshToken = jwt.sign(
        { userId: user._id, type: "refresh" },
        JWT_REFRESH_SECRET,
        { expiresIn: JWT_REFRESH_EXPIRES_IN }
      );

      // Supprimer les anciens refresh tokens de l'utilisateur
      await RefreshToken.deleteMany({ userId: user._id });

      // Stocker le nouveau refresh token en DB avec TTL
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 jours

      await RefreshToken.create({
        userId: user._id,
        token: refreshToken,
        expiresAt,
      });

      return { accessToken, refreshToken };
    } catch (error) {
      throw new Error("Erreur lors de la génération des tokens");
    }
  }

  static async verifyToken(token) {
    try {
      // Vérifier si le token est blacklisté
      const blacklisted = await BlacklistedToken.findOne({ token });
      if (blacklisted) {
        throw new Error("Token révoqué");
      }

      const decoded = jwt.verify(token, JWT_SECRET, {
        issuer: "immova-api",
        audience: "immova-client",
      });

      // Ajouter les informations d'expiration au decoded token
      decoded.shouldRenew = this.shouldRenewToken(decoded);
      return decoded;
    } catch (error) {
      throw new Error(`Token invalide: ${error.message}`);
    }
  }

  /**
   * Vérifie si le token doit être renouvelé (expire dans moins de 15 minutes)
   * @param {Object} decoded - Token JWT décodé
   * @returns {boolean} True si le token doit être renouvelé
   */
  static shouldRenewToken(decoded) {
    const now = Math.floor(Date.now() / 1000);
    const timeUntilExpiry = decoded.exp - now;
    const fifteenMinutes = 15 * 60; // 15 minutes en secondes

    return timeUntilExpiry < fifteenMinutes;
  }

  static async refreshTokens(refreshToken) {
    try {
      // Vérifier le refresh token JWT
      const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);

      // Vérifier que le token existe en DB et n'a pas expiré
      const storedToken = await RefreshToken.findOne({
        userId: decoded.userId,
        token: refreshToken,
      });

      if (!storedToken) {
        throw new Error("Refresh token invalide ou expiré");
      }

      // Vérifier l'expiration manuelle (sécurité supplémentaire)
      if (storedToken.expiresAt < new Date()) {
        await RefreshToken.deleteOne({ _id: storedToken._id });
        throw new Error("Refresh token expiré");
      }

      // Générer nouveaux tokens
      const user = { _id: decoded.userId };
      return await this.generateTokens(user);
    } catch (error) {
      throw new Error("Refresh token invalide");
    }
  }

  static async revokeToken(token, userId) {
    try {
      // Décoder le token pour obtenir l'expiration
      const decoded = jwt.decode(token);
      const expiresAt = new Date(decoded.exp * 1000);

      // Ajouter à la blacklist avec TTL
      await BlacklistedToken.create({
        token,
        userId,
        expiresAt,
      });
    } catch (error) {
      throw new Error("Erreur lors de la révocation du token");
    }
  }

  static async revokeUserTokens(userId) {
    try {
      // Supprimer tous les refresh tokens de l'utilisateur
      await RefreshToken.deleteMany({ userId });
    } catch (error) {
      throw new Error("Erreur lors de la révocation des tokens");
    }
  }
}

// --- Optional Authentication Middleware ---
// Does not block if no token is present
export const optionalAuth = async (req, res, next) => {
  const token = req.cookies?.accessToken;
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const decoded = await SecureAuthService.verifyToken(token);
    req.user = decoded;
  } catch (error) {
    req.user = null; // Token invalide ou expiré
  }
  next();
};

// --- Main Authentication Middleware ---
// Secure cookie-based authentication with auto-refresh
export const authenticateToken = async (req, res, next) => {
  try {
    // Récupération du token depuis les cookies
    const token = req.cookies?.accessToken;

    if (!token) {
      return res.status(401).json({ error: "Token manquant" });
    }

    const decoded = await SecureAuthService.verifyToken(token);

    // Renouvellement automatique si le token va expirer bientôt
    if (decoded.shouldRenew) {
      try {
        const refreshToken = req.cookies?.refreshToken;
        if (refreshToken) {
          const newTokens = await SecureAuthService.refreshTokens(refreshToken);

          // Configuration cookies
          const isProd = process.env.NODE_ENV === "production";
          const cookieConfig = {
            httpOnly: true,
            secure: isProd,
            sameSite: isProd ? "none" : "lax",
            domain: isProd ? process.env.COOKIE_DOMAIN : undefined,
            path: "/",
          };

          // Définir nouveaux cookies
          res.cookie("accessToken", newTokens.accessToken, {
            ...cookieConfig,
            maxAge: 60 * 60 * 1000, // 1 heure
          });

          res.cookie("refreshToken", newTokens.refreshToken, {
            ...cookieConfig,
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
          });

          // Mettre à jour le token décodé
          const newDecoded = await SecureAuthService.verifyToken(
            newTokens.accessToken
          );
          req.user = newDecoded;
        } else {
          req.user = decoded;
        }
      } catch (renewError) {
        req.user = decoded; // Utiliser l'ancien token même s'il expire bientôt
      }
    } else {
      req.user = decoded;
    }

    next();
  } catch (error) {
    // Tentative de refresh automatique
    const refreshToken = req.cookies?.refreshToken;
    if (refreshToken) {
      try {
        const newTokens = await SecureAuthService.refreshTokens(refreshToken);

        // Définir nouveaux cookies
        const isProd = process.env.NODE_ENV === "production";

        // ✅ Configuration cookies
        const cookieConfig = {
          httpOnly: true,
          secure: isProd,
          sameSite: isProd ? "none" : "lax",
          domain: isProd ? process.env.COOKIE_DOMAIN : undefined,
          path: "/",
        };

        res.cookie("accessToken", newTokens.accessToken, {
          ...cookieConfig,
          maxAge: 60 * 60 * 1000, // 60 minutes
        });

        res.cookie("refreshToken", newTokens.refreshToken, {
          ...cookieConfig,
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
        });

        const decoded = await SecureAuthService.verifyToken(
          newTokens.accessToken
        );
        req.user = decoded;
        return next();
      } catch (refreshError) {
        // Refresh échoué, supprimer cookies
        res.clearCookie("accessToken");
        res.clearCookie("refreshToken");
      }
    }

    return res.status(401).json({ error: "Non authentifié" });
  }
};

// --- Role-Based Authorization Middleware ---
export const requireRole = (roles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Permissions insuffisantes" });
    }

    next();
  };
};

// --- CSRF Protection Middleware ---
export const csrfProtection = (req, res, next) => {
  if (["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) {
    const origin = req.get("Origin");
    const referer = req.get("Referer");
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      "https://v-a-front-ghh5c3rw9-vileaus-projects.vercel.app",
    ];

    if (!origin && !referer) {
      return res.status(403).json({ error: "Origine manquante" });
    }

    const requestOrigin = origin || new URL(referer).origin;
    if (!allowedOrigins.includes(requestOrigin)) {
      return res.status(403).json({ error: "Origine non autorisée" });
    }
  }

  next();
};
