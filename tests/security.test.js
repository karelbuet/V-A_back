// ======================================
// --- AUTOMATED SECURITY TESTS ---
// ======================================
// Comprehensive security testing suite for the immoVA application

import request from 'supertest';
import { expect } from 'chai';
import app from '../app.js';
import { SecureAuthService } from '../middleware/auth.js';

describe('Security Tests', () => {
  
  describe('🔒 Authentication & Authorization', () => {
    
    it('should reject requests without authentication token', async () => {
      const response = await request(app)
        .get('/prices/valery-sources-baie')
        .expect(401);
        
      expect(response.body).to.have.property('error');
    });
    
    it('should reject invalid JWT tokens', async () => {
      const response = await request(app)
        .get('/prices/valery-sources-baie')
        .set('Cookie', 'accessToken=invalid_token')
        .expect(401);
        
      expect(response.body.error).to.equal('Non authentifié');
    });
    
    it('should enforce role-based access control', async () => {
      // Simuler un utilisateur normal (non-admin)
      const userToken = SecureAuthService.generateTokens({
        _id: 'user123',
        email: 'user@test.com',
        role: 'user'
      });
      
      const response = await request(app)
        .post('/prices')
        .set('Cookie', `accessToken=${userToken.accessToken}`)
        .send({
          property: 'valery-sources-baie',
          name: 'Test Rule',
          startDate: '2024-01-01',
          endDate: '2024-01-02',
          pricePerNight: 100
        })
        .expect(403);
        
      expect(response.body.error).to.equal('Permissions insuffisantes');
    });
  });

  describe('🛡️ Input Validation & Sanitization', () => {
    
    it('should reject XSS attempts in form inputs', async () => {
      const xssPayload = '<script>alert("xss")</script>';
      
      const response = await request(app)
        .post('/users/register')
        .send({
          email: `test${xssPayload}@example.com`,
          password: 'validPassword123',
          name: xssPayload
        })
        .expect(400);
        
      expect(response.body.error).to.equal('Données invalides');
    });
    
    it('should validate email format strictly', async () => {
      const invalidEmails = [
        'notanemail',
        '@example.com', 
        'test@',
        'test..test@example.com',
        'test@example',
      ];
      
      for (const email of invalidEmails) {
        const response = await request(app)
          .post('/users/login')
          .send({
            email,
            password: 'validPassword123'
          })
          .expect(400);
          
        expect(response.body.error).to.equal('Données invalides');
      }
    });
    
    it('should reject NoSQL injection attempts', async () => {
      const injectionPayloads = [
        { $ne: null },
        { $gt: '' },
        { $regex: '.*' },
        { $where: 'this.password.length > 0' }
      ];
      
      for (const payload of injectionPayloads) {
        const response = await request(app)
          .post('/users/login')
          .send({
            email: payload,
            password: 'test123'
          })
          .expect(400);
          
        expect(response.body.error).to.equal('Données invalides');
      }
    });
    
    it('should enforce price range limits', async () => {
      const adminToken = SecureAuthService.generateTokens({
        _id: 'admin123',
        email: 'admin@test.com', 
        role: 'admin'
      });
      
      // Prix négatif
      await request(app)
        .post('/prices')
        .set('Cookie', `accessToken=${adminToken.accessToken}`)
        .send({
          property: 'valery-sources-baie',
          name: 'Test Rule',
          startDate: '2024-01-01',
          endDate: '2024-01-02', 
          pricePerNight: -100
        })
        .expect(400);
        
      // Prix trop élevé  
      await request(app)
        .post('/prices')
        .set('Cookie', `accessToken=${adminToken.accessToken}`)
        .send({
          property: 'valery-sources-baie',
          name: 'Test Rule',
          startDate: '2024-01-01',
          endDate: '2024-01-02',
          pricePerNight: 99999
        })
        .expect(400);
    });
  });

  describe('🌐 CSRF & CORS Protection', () => {
    
    it('should reject cross-origin requests without proper CORS', async () => {
      const response = await request(app)
        .get('/prices/valery-sources-baie')
        .set('Origin', 'https://evil-site.com')
        .expect(403);
    });
    
    it('should enforce CSRF protection on state-changing requests', async () => {
      const adminToken = SecureAuthService.generateTokens({
        _id: 'admin123',
        email: 'admin@test.com',
        role: 'admin'
      });
      
      const response = await request(app)
        .post('/prices')
        .set('Cookie', `accessToken=${adminToken.accessToken}`)
        .set('Origin', 'https://evil-site.com')
        .send({
          property: 'valery-sources-baie',
          name: 'Evil Rule',
          startDate: '2024-01-01',
          endDate: '2024-01-02',
          pricePerNight: 100
        })
        .expect(403);
        
      expect(response.body.error).to.equal('Origine non autorisée');
    });
  });

  describe('⚡ Rate Limiting', () => {
    
    it('should enforce authentication rate limiting', async () => {
      const promises = [];
      
      // Faire 6 tentatives de connexion (limite = 5)
      for (let i = 0; i < 6; i++) {
        promises.push(
          request(app)
            .post('/users/login')
            .send({
              email: 'test@example.com',
              password: 'wrongpassword'
            })
        );
      }
      
      const responses = await Promise.all(promises);
      const lastResponse = responses[responses.length - 1];
      
      expect(lastResponse.status).to.equal(429);
      expect(lastResponse.body.error).to.include('Trop de tentatives');
    });
    
    it('should enforce global rate limiting', async () => {
      const promises = [];
      
      // Faire 101 requêtes (limite globale = 100)
      for (let i = 0; i < 101; i++) {
        promises.push(
          request(app)
            .get('/calendar/availability')
        );
      }
      
      const responses = await Promise.all(promises);
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      
      expect(rateLimitedResponses.length).to.be.greaterThan(0);
    });
  });

  describe('🔍 Security Headers', () => {
    
    it('should set security headers correctly', async () => {
      const response = await request(app)
        .get('/calendar/availability')
        .expect(200);
        
      expect(response.headers).to.have.property('x-frame-options', 'DENY');
      expect(response.headers).to.have.property('x-content-type-options', 'nosniff');
      expect(response.headers).to.have.property('content-security-policy');
      expect(response.headers).to.have.property('strict-transport-security');
      expect(response.headers).to.not.have.property('x-powered-by');
    });
    
    it('should include proper CSP directives', async () => {
      const response = await request(app)
        .get('/calendar/availability')
        .expect(200);
        
      const csp = response.headers['content-security-policy'];
      expect(csp).to.include("default-src 'none'");
      expect(csp).to.include("script-src 'self'");
      expect(csp).to.include("frame-ancestors 'none'");
      expect(csp).to.include("object-src 'none'");
    });
  });

  describe('📝 Logging & Monitoring', () => {
    
    it('should log security events without exposing sensitive data', async () => {
      let loggedData = null;
      const originalLog = console.log;
      
      console.log = (data) => {
        try {
          loggedData = JSON.parse(data);
        } catch (e) {
          // Not JSON, ignore
        }
        originalLog(data);
      };
      
      await request(app)
        .post('/users/login')
        .send({
          email: 'test@example.com',
          password: 'wrongpassword'
        });
        
      console.log = originalLog;
      
      expect(loggedData).to.be.not.null;
      expect(loggedData).to.have.property('method', 'POST');
      expect(loggedData).to.have.property('statusCode');
      expect(loggedData).to.have.property('duration');
      expect(loggedData).to.not.have.property('password');
      expect(loggedData).to.not.have.property('token');
    });
  });

  describe('🔐 JWT Security', () => {
    
    it('should generate secure JWT tokens', () => {
      const user = {
        _id: 'user123',
        email: 'test@example.com',
        role: 'user'
      };
      
      const tokens = SecureAuthService.generateTokens(user);
      
      expect(tokens).to.have.property('accessToken');
      expect(tokens).to.have.property('refreshToken');
      expect(tokens.accessToken).to.be.a('string');
      expect(tokens.refreshToken).to.be.a('string');
      
      // Vérifier que les tokens sont différents
      expect(tokens.accessToken).to.not.equal(tokens.refreshToken);
    });
    
    it('should reject tampered JWT tokens', () => {
      const user = {
        _id: 'user123',
        email: 'test@example.com', 
        role: 'user'
      };
      
      const { accessToken } = SecureAuthService.generateTokens(user);
      const tamperedToken = accessToken.slice(0, -10) + 'tampered123';
      
      expect(() => {
        SecureAuthService.verifyToken(tamperedToken);
      }).to.throw('Token invalide');
    });
  });
});