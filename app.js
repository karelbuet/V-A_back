import "dotenv/config";
import "./models/connection.js";
import express from "express";
import cookieParser from "cookie-parser";
import logger from "morgan";
import compression from "compression";
import cors from "cors";

// Import des middlewares de sécurité
import {
  securityHeaders,
  rateLimitConfig,
  secureLogger,
} from "./middleware/security.js";
import {
  authenticateToken,
  requireRole,
  csrfProtection,
} from "./middleware/auth.js";

import usersRouter from "./routes/users.js";
import commentsRouter from "./routes/comments.js";
import bookingRouter from "./routes/booking.js";
import cartRouter from "./routes/cart.js";
import sendMailRouter from "./routes/sendMail.js";
import calendarRouter from "./routes/calendar.js";
import pricesRouter from "./routes/prices.js";
import logoutRouter from "./routes/logout.js";
import tokenInfoRouter from "./routes/token-info.js";

const app = express();

app.set("trust proxy", 1);

const isProd =
  process.env.NODE_ENV === "production" || process.env.VERCEL === "1";

const allowedOrigins = [
  "https://v-a-front-ghh5c3rw9-vileaus-projects.vercel.app",
  "https://v-a-back.vercel.app",
  "https://v-a-back-m10ubwsp0-vileaus-projects.vercel.app",
  process.env.FRONTEND_URL,
  "http://localhost:3000",
  "http://localhost:5173",
].filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error("CORS origin rejected:", origin);
      callback(new Error("Non autorisé par CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Correlation-ID",
    "Accept",
    "Origin",
    "X-Requested-With",
  ],
  exposedHeaders: ["X-Total-Count"],
  optionsSuccessStatus: 200, // ✅ Pour les anciens navigateurs
};

// Application des middlewares de sécurité
securityHeaders(app);
app.use(cors(corsOptions));
app.use(rateLimitConfig.global);

// ✨ OPTIMISATION - Configuration compression Brotli optimisée
app.use(compression({ level: 6, threshold: 1024 }));

app.use(secureLogger);

app.use(logger("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false, limit: "10mb" }));
app.use(cookieParser());

// Handle OPTIONS requests explicitly before CSRF protection
app.options("*", cors(corsOptions));

// Route racine pour Vercel
app.get("/", (req, res) => {
  res.json({ result: true, message: "ImmoVA Backend API", status: "running" });
});

// Routes publiques
app.use("/users", usersRouter);
app.use("/comments", commentsRouter);
app.use("/calendar", calendarRouter);
app.use("/sendMail", sendMailRouter);
app.use("/booking", bookingRouter);

// Routes avec protection CSRF (sauf actions email)
app.use((req, res, next) => {
  // Exclure les actions email de la protection CSRF
  if (req.path.startsWith("/booking/email-action/")) {
    return next();
  }
  return csrfProtection(req, res, next);
});

// Routes d'authentification
app.use("/auth", logoutRouter);

// Routes protégées
app.use("/bookings", authenticateToken, bookingRouter);
app.use("/cart", authenticateToken, cartRouter);
app.use("/prices", authenticateToken, requireRole(["admin"]), pricesRouter);
app.use("/token", authenticateToken, tokenInfoRouter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  res.status(404).json({ result: false, error: "Route non trouvée" });
});

// error handler
app.use(function (err, req, res, next) {
  console.error("Erreur serveur:", err);
  const status = err.status || 500;
  const message =
    app.get("env") === "development"
      ? err.message
      : "Erreur interne du serveur";
  res.status(status).json({ result: false, error: message });
});

export default app;
