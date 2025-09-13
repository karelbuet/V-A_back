import jwt from "jsonwebtoken";

const SECRET_KEY = process.env.SECRET_KEY;

/**
 * Génère un token JWT pour un utilisateur
 * @param {Object} user - L'objet utilisateur
 * @returns {string} Le token JWT
 */
export function generateUserToken(user) {
  return jwt.sign(
    {
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
      id: user._id.toString(),
      username: user.username,
      phone: user.phone,
      role: user.role,
    },
    SECRET_KEY,
    { expiresIn: "7d" }
  );
}

/**
 * Valide un email avec regex
 * @param {string} email - L'email à valider
 * @returns {boolean} True si l'email est valide
 */
export function isValidEmail(email) {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
}

/**
 * Sanitise un objet utilisateur pour la réponse (supprime le mot de passe)
 * @param {Object} user - L'objet utilisateur
 * @returns {Object} L'objet utilisateur sans le mot de passe
 */
export function sanitizeUser(user) {
  const userResponse = user.toObject ? user.toObject() : { ...user };
  delete userResponse.password;
  return userResponse;
}

/**
 * Normalise un email (trim et lowercase)
 * @param {string} email - L'email à normaliser
 * @returns {string} L'email normalisé
 */
export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}