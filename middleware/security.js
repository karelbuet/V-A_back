import helmet from "helmet";
import rateLimit from "express-rate-limit";
import crypto from "crypto";

export const securityHeaders = (app) => {
  app.use((req, res, next) => {
    res.locals.nonce = crypto.randomBytes(16).toString("base64");
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          scriptSrc: [
            "'self'",
            "'strict-dynamic'",
            (req, res) => `'nonce-${res.locals.nonce}'`,
          ],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          frameSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          baseUri: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
      crossOriginEmbedderPolicy: { policy: "require-corp" },
      crossOriginOpenerPolicy: { policy: "same-origin" },
      crossOriginResourcePolicy: { policy: "cross-origin" },
      dnsPrefetchControl: true,
      frameguard: { action: "deny" },
      hidePoweredBy: true,
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      ieNoOpen: true,
      noSniff: true,
      originAgentCluster: true,
      permittedCrossDomainPolicies: false,
      referrerPolicy: { policy: "no-referrer" },
      xssFilter: true,
    })
  );
};

// Rate limiting global et ciblé
export const rateLimitConfig = {
  global: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: { error: "Trop de requêtes, réessayez plus tard" },
    standardHeaders: true,
    legacyHeaders: false,
  }),

  auth: rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5, // 5 tentatives de connexion max (pour autres routes d'auth)
    message: { error: "Trop de tentatives de connexion" },
    skipSuccessfulRequests: true,
  }),

  login: rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 15, // 15 tentatives de connexion par minute
    message: { error: "Trop de tentatives de connexion, réessayez dans 1 minute" },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false, // Compter toutes les requêtes login (succès + échec)
  }),

  api: rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30,
    message: { error: "API rate limit dépassé" },
  }),

  public: rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10, // 10 actions email par 5 minutes par IP
    message: { error: "Trop d'actions depuis cet email, réessayez plus tard" },
    standardHeaders: true,
  }),
};

// Middleware de validation basique des entrées
export const validateInput = (validationRules) => {
  return (req, res, next) => {
    try {
      // Validation basique sans Zod pour éviter les dépendances
      for (const [field, rules] of Object.entries(validationRules)) {
        const value = req.body[field];

        if (rules.required && (!value || value === "")) {
          return res.status(400).json({
            error: "Données invalides",
            details: [{ field, message: `${field} est requis` }],
          });
        }

        if (rules.email && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          return res.status(400).json({
            error: "Données invalides",
            details: [{ field, message: "Email invalide" }],
          });
        }

        if (rules.minLength && value && value.length < rules.minLength) {
          return res.status(400).json({
            error: "Données invalides",
            details: [{ field, message: `${field} trop court` }],
          });
        }

        if (rules.maxLength && value && value.length > rules.maxLength) {
          return res.status(400).json({
            error: "Données invalides",
            details: [{ field, message: `${field} trop long` }],
          });
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

// Schémas de validation simplifiés
export const ValidationSchemas = {
  login: {
    email: { required: true, email: true, maxLength: 255 },
    password: { required: true, minLength: 8, maxLength: 128 },
  },

  priceRule: {
    property: { required: true },
    name: { required: true, minLength: 1, maxLength: 100 },
    startDate: { required: true },
    endDate: { required: true },
    pricePerNight: { required: true },
  },

  booking: {
    property: { required: true },
    startDate: { required: true },
    endDate: { required: true },
    guests: { required: true },
    email: { required: true, email: true, maxLength: 255 },
    phone: { required: true },
  },
};

// Middleware de logging sécurisé
export const secureLogger = (req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const logData = {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get("User-Agent")?.substring(0, 200),
      ip: req.ip,
      correlationId: req.headers["x-correlation-id"] || crypto.randomUUID(),
    };

    // Ne pas logger les données sensibles
    if (req.body && !req.url.includes("/auth/")) {
      logData.bodySize = JSON.stringify(req.body).length;
    }

    console.log(JSON.stringify(logData));
  });

  next();
};
