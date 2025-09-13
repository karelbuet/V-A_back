// Middleware pour vérifier le rôle de l'utilisateur
export function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ result: false, error: "Accès refusé" });
    }
    next();
  };
}
