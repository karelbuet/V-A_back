import express from "express";
import argon2 from "argon2";
import User from "../models/users.js";
import { authenticateToken } from "../middleware/auth.js";
import { optionalAuth } from "../middleware/auth.js";
import { checkBody } from "../modules/checkBody.js";
import { authorizeRoles } from "../modules/authorizeRoles.js";
import {
  generateUserToken,
  isValidEmail,
  sanitizeUser,
  normalizeEmail,
} from "../modules/userHelpers.js";
import { SecureAuthService } from "../middleware/auth.js";
import { rateLimitConfig } from "../middleware/security.js";

var router = express.Router();


// ======================================
// --- USER MANAGEMENT ROUTES ---
// ======================================

// --- User Registration ---
router.post("/register", async (req, res) => {
  try {
    // Vérifie que tous les champs nécessaires sont présents
    if (!checkBody(req.body, ["lastname", "firstname", "email", "password"])) {
      return res
        .status(400)
        .json({ result: false, error: "Champs manquants ou vides" });
    }

    // Normalise et valide l'email
    const email = normalizeEmail(req.body.email);
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      return res
        .status(400)
        .json({ result: false, error: "Adresse email non valide" });
    }

    // Vérifie si l'utilisateur existe déjà
    const existingUser = await User.findOne({
      $or: [{ email }, { username: req.body.username?.trim() }],
    });

    if (existingUser) {
      return res
        .status(409)
        .json({ result: false, error: "L'utilisateur existe déjà !" });
    }

    // Hash du mot de passe
    const hash = await argon2.hash(req.body.password, {
      type: argon2.argon2id,
      memoryCost: 2 ** 16,
      timeCost: 3,
      parallelism: 1,
    });

    // Création du nouvel utilisateur
    const newUser = new User({
      firstname: req.body.firstname.trim(),
      lastname: req.body.lastname?.trim() || "",
      email,
      password: hash,
      username: "non défini",
      phone: "non défini",
      role: "user",
    });

    await newUser.save();

    // Générer les tokens sécurisés
    let accessToken, refreshToken;
    try {
      const tokens = await SecureAuthService.generateTokens(newUser);
      accessToken = tokens.accessToken;
      refreshToken = tokens.refreshToken;
    } catch (tokenError) {
      console.error("Erreur génération tokens inscription:", tokenError);
      return res.status(500).json({
        result: false,
        error: "Erreur lors de la création du compte",
      });
    }

    const isProd = process.env.NODE_ENV === "production";

    // ✅ Configuration cookies optimisée pour cross-origin localhost
    const cookieConfig = {
      httpOnly: true, // ✅ Sécurité : pas d'accès JavaScript
      secure: isProd, // ✅ HTTPS uniquement en production
      sameSite: isProd ? "none" : "lax", // ✅ "none" pour prod cross-domain, "lax" pour dev localhost
      domain: isProd ? process.env.COOKIE_DOMAIN : undefined, // ✅ Pas de domain en dev pour localhost
      path: "/", // ✅ Cookie disponible sur tout le site
    };

    res.cookie("accessToken", accessToken, {
      ...cookieConfig,
      maxAge: 60 * 60 * 1000, // 1 heure
    });

    res.cookie("refreshToken", refreshToken, {
      ...cookieConfig,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
    });

    res.status(201).json({
      result: true,
      user: sanitizeUser(newUser),
      message: "Compte créé avec succès",
    });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ result: false, error: "Internal server error" });
  }
});

// --- User Login (with Rate Limiting) ---
router.post("/login", rateLimitConfig.login, async (req, res) => {
  try {

    if (!checkBody(req.body, ["email", "password"])) {
      return res.json({ result: false, error: "Champs manquants ou vides" });
    }

    const email = normalizeEmail(req.body.email);
    if (!isValidEmail(email)) {
      return res.json({ result: false, error: "Format d'email invalide" });
    }

    const user = await User.findOne({ email });

    if (
      !user ||
      !(await argon2.verify(user.password, req.body.password.trim()))
    ) {
      return res.json({ result: false, error: "Invalid email or password" });
    }

    // Générer les tokens sécurisés
    let accessToken, refreshToken;
    try {
      const tokens = await SecureAuthService.generateTokens(user);
      accessToken = tokens.accessToken;
      refreshToken = tokens.refreshToken;
    } catch (tokenError) {
      console.error("Erreur génération tokens connexion:", tokenError);
      return res.status(500).json({
        result: false,
        error: "Erreur lors de la connexion",
      });
    }

    const isProd = process.env.NODE_ENV === "production";

    // ✅ Configuration cookies optimisée pour cross-origin localhost
    const cookieConfig = {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      domain: isProd ? process.env.COOKIE_DOMAIN : undefined,
      path: "/",
    };


    res.cookie("accessToken", accessToken, {
      ...cookieConfig,
      maxAge: 60 * 60 * 1000, // 1 heure
    });

    res.cookie("refreshToken", refreshToken, {
      ...cookieConfig,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
    });


    res.json({
      result: true,
      user: sanitizeUser(user),
      message: "Connexion réussie",
    });
  } catch (err) {
    console.error("Signin error:", err);
    res.status(500).json({ result: false, error: "Internal server error" });
  }
});

// ======================================
// --- PROFILE MANAGEMENT ROUTES ---
// ======================================

// --- Delete User Account ---
router.delete("/profile/delete", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const user = await User.findById(userId);
    if (!user)
      return res
        .status(404)
        .json({ result: false, error: "Utilisateur non trouvé" });

    await User.findByIdAndDelete(userId);
    res.json({ result: true, message: "Compte supprimé avec succès" });
  } catch (err) {
    console.error("Erreur delete account:", err);
    res.status(500).json({
      result: false,
      error: "Erreur lors de la suppression du compte",
    });
  }
});

// --- Update Last Name ---
router.put("/update/lastname", authenticateToken, async (req, res) => {
  try {
    const { lastname } = req.body;
    const userId = req.user.userId;

    if (!lastname || !lastname.trim()) {
      return res
        .status(400)
        .json({ result: false, error: "Le nom de famille est requis" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ result: false, error: "Utilisateur non trouvé" });
    }

    user.lastname = lastname.trim();
    await user.save();

    const userResponse = sanitizeUser(user);
    const token = generateUserToken(user);

    res.json({ result: true, token, user: userResponse });
  } catch (err) {
    console.error("Erreur update profile:", err);
    res.status(500).json({
      result: false,
      error: "Erreur lors de la mise à jour du nom de famille",
      details: err.message,
    });
  }
});

// --- Update First Name ---
router.put("/update/firstname", authenticateToken, async (req, res) => {
  try {
    const { firstname } = req.body;
    const userId = req.user.userId;

    if (!firstname || !firstname.trim()) {
      return res
        .status(400)
        .json({ result: false, error: "Le prénom est requis" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ result: false, error: "Utilisateur non trouvé" });
    }

    user.firstname = firstname.trim();
    await user.save();

    const userResponse = sanitizeUser(user);
    const token = generateUserToken(user);

    res.json({ result: true, token, user: userResponse });
  } catch (err) {
    console.error("Erreur update profile:", err);
    res.status(500).json({
      result: false,
      error: "Erreur lors de la mise à jour du prénom",
      details: err.message,
    });
  }
});

// --- Update Username ---
router.put("/update/username", authenticateToken, async (req, res) => {
  try {
    const { username } = req.body;
    const userId = req.user.userId;

    if (!username || !username.trim()) {
      return res
        .status(400)
        .json({ result: false, error: "Le pseudo est requis" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ result: false, error: "Utilisateur non trouvé" });
    }

    user.username = username.trim();
    await user.save();

    const userResponse = sanitizeUser(user);
    const token = generateUserToken(user);

    res.json({ result: true, token, user: userResponse });
  } catch (err) {
    console.error("Erreur update profile:", err);
    res.status(500).json({
      result: false,
      error: "Erreur lors de la mise à jour du pseudo",
      details: err.message,
    });
  }
});

// --- Update Phone Number ---
router.put("/update/phone", authenticateToken, async (req, res) => {
  try {
    const { phone } = req.body;
    const userId = req.user.userId;

    if (!phone || !phone.trim()) {
      return res
        .status(400)
        .json({ result: false, error: "Le numéro de téléphone est requis" });
    }

    // Validation du format du téléphone
    const phoneRegex = /^(?:\+33|0)[1-9](?:[0-9]{8})$|^(?:\+33\s?|0)[1-9](?:\s?[0-9]{2}){4}$/;
    const cleanPhone = phone.trim().replace(/\s/g, '');
    if (!phoneRegex.test(cleanPhone) || cleanPhone.length < 10) {
      return res
        .status(400)
        .json({ result: false, error: "Numéro de téléphone non valide" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ result: false, error: "Utilisateur non trouvé" });
    }

    user.phone = phone.trim();
    await user.save();

    const userResponse = sanitizeUser(user);
    const token = generateUserToken(user);

    res.json({ result: true, token, user: userResponse });
  } catch (err) {
    console.error("Erreur update profile:", err);
    res.status(500).json({
      result: false,
      error: "Erreur lors de la mise à jour du numéro de téléphone",
      details: err.message,
    });
  }
});

// --- Update Email ---
router.put("/update/email", authenticateToken, async (req, res) => {
  try {
    const { email } = req.body;
    const userId = req.user.userId;

    if (!email || !email.trim()) {
      return res
        .status(400)
        .json({ result: false, error: "L'email est requis" });
    }

    // Vérification du format de l'email
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email.trim())) {
      return res
        .status(400)
        .json({ result: false, error: "Adresse email non valide" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ result: false, error: "Utilisateur non trouvé" });
    }

    user.email = email.trim();
    await user.save();

    const userResponse = sanitizeUser(user);
    const token = generateUserToken(user);

    res.json({ result: true, token, user: userResponse });
  } catch (err) {
    console.error("Erreur update profile:", err);
    res.status(500).json({
      result: false,
      error: "Erreur lors de la mise à jour de l'email",
      details: err.message,
    });
  }
});

// --- Update Password ---
router.put("/updatePassword", authenticateToken, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.userId; // ✅ Cohérent avec le middleware auth.js

    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        result: false,
        error: "Ancien mot de passe et nouveau mot de passe sont requis",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ result: false, error: "Utilisateur non trouvé" });
    }

    // Vérifie l'ancien mot de passe
    const isValid = await argon2.verify(user.password, oldPassword);
    if (!isValid) {
      return res
        .status(400)
        .json({ result: false, error: "Ancien mot de passe incorrect" });
    }

    // Hash du nouveau mot de passe
    user.password = await argon2.hash(newPassword, { type: argon2.argon2id });
    await user.save();

    res.json({ result: true, message: "Mot de passe mis à jour avec succès" });
  } catch (err) {
    console.error("Erreur update password:", err);
    res.status(500).json({ result: false, error: "Erreur serveur" });
  }
});

// --- Update Complete Profile ---
router.put("/profile/update", authenticateToken, async (req, res) => {
  try {
    const { firstname, lastname, email, password, oldPassword, username } =
      req.body;
    const userId = req.user.userId;

    const user = await User.findById(userId);
    if (!user)
      return res
        .status(404)
        .json({ result: false, error: "Utilisateur non trouvé" });

    // Vérifie unicité email et username
    if (email && email !== user.email) {
      const normalizedEmail = normalizeEmail(email);
      if (!isValidEmail(normalizedEmail)) {
        return res
          .status(400)
          .json({ result: false, error: "Format d'email invalide" });
      }
      const existsEmail = await User.findOne({
        email: normalizedEmail,
        _id: { $ne: userId },
      });
      if (existsEmail)
        return res
          .status(400)
          .json({ result: false, error: "Cet email est déjà utilisé" });
      user.email = normalizedEmail;
    }
    if (username && username !== user.username) {
      const existsUsername = await User.findOne({
        username,
        _id: { $ne: userId },
      });
      if (existsUsername)
        return res.status(400).json({
          result: false,
          error: "Ce nom d'utilisateur est déjà utilisé",
        });
      user.username = username;
    }

    if (firstname) user.firstname = firstname;
    if (lastname) user.lastname = lastname;

    // Changement de mot de passe
    if (password) {
      if (!oldPassword)
        return res
          .status(400)
          .json({ result: false, error: "L'ancien mot de passe est requis" });
      const isValid = await argon2.verify(user.password, oldPassword);
      if (!isValid)
        return res.status(400).json({
          result: false,
          error: "L'ancien mot de passe est incorrect",
        });
      user.password = await argon2.hash(password, { type: argon2.argon2id });
    }

    await user.save();

    const userResponse = sanitizeUser(user);
    const token = generateUserToken(user);

    res.json({ result: true, token, user: userResponse });
  } catch (err) {
    console.error("Erreur update profile:", err);
    res.status(500).json({
      result: false,
      error: "Erreur lors de la mise à jour du profil",
      details: err.message,
    });
  }
});

// ======================================
// --- AUTHENTICATION VERIFICATION ---
// ======================================

// --- Get Current User Info ---
router.get("/me", optionalAuth, async (req, res) => {
  try {
    if (!req.user) {
      return res.json({
        result: true,
        user: null,
        isAuthenticated: false,
      });
    }

    const user = await User.findById(req.user.userId).select("-password");
    if (!user) {
      return res.json({
        result: true,
        user: null,
        isAuthenticated: false,
      });
    }

    res.json({
      result: true,
      user: sanitizeUser(user),
      isAuthenticated: true,
    });
  } catch (err) {
    console.error("Erreur get user info:", err);
    res.status(500).json({ result: false, error: "Erreur serveur" });
  }
});

export default router;
