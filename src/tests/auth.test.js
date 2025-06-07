const request = require('supertest');
const app = require('../../src/index');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();

beforeEach(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.worker.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.business.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Auth Routes', () => {
  describe('POST /auth/register', () => {
    it('should register an individual user successfully', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'test@example.com',
          password: 'password123',
          name: 'Test User',
          username: 'testuser',
          isBusiness: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();

      const user = await prisma.user.findUnique({ where: { email: 'test@example.com' } });
      expect(user).toBeDefined();
      expect(user.username).toBe('testuser');
      expect(user.isBusiness).toBe(false);

      const business = await prisma.business.findUnique({ where: { userId: user.id } });
      expect(business).toBeDefined();
      expect(business.name).toBe('Agenda de Test User');

      const worker = await prisma.worker.findFirst({ where: { businessId: business.id } });
      expect(worker).toBeDefined();
      expect(worker.workerName).toBe('Test User');
      expect(worker.isOwner).toBe(true);

      const schedule = await prisma.schedule.findFirst({ where: { businessId: business.id } });
      expect(schedule).toBeDefined();
    });

    it('should register a business user successfully', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'business@example.com',
          password: 'password123',
          username: 'businessuser',
          businessName: 'Test Business',
          isBusiness: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();

      const user = await prisma.user.findUnique({ where: { email: 'business@example.com' } });
      expect(user.isBusiness).toBe(true);

      const business = await prisma.business.findUnique({ where: { userId: user.id } });
      expect(business.name).toBe('Test Business');

      const branch = await prisma.branch.findFirst({ where: { businessId: business.id } });
      expect(branch).toBeDefined();
      expect(branch.name).toBe('Sucursal Principal');
    });

    it('should fail if email or username exists', async () => {
      await prisma.user.create({
        data: {
          email: 'test@example.com',
          password: 'hashed',
          username: 'otheruser',
        },
      });

      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'test@example.com',
          password: 'password123',
          name: 'Test User',
          username: 'testuser',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Email o username ya existen');
    });

    it('should fail with invalid username', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'test@example.com',
          password: 'password123',
          name: 'Test User',
          username: 'invalid@username',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('username');
    });
  });

  describe('GET /auth/verify', () => {
    it('should verify user successfully', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test@example.com',
          password: 'hashed',
          username: 'testuser',
          isVerified: false,
        },
      });

      const token = await prisma.verificationToken.create({
        data: {
          userId: user.id,
          token: 'valid-token',
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        },
      });

      const res = await request(app).get('/auth/verify').query({ token: 'valid-token' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Cuenta verificada exitosamente');

      const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
      expect(updatedUser.isVerified).toBe(true);
    });

    it('should fail with invalid token', async () => {
      const res = await request(app).get('/auth/verify').query({ token: 'invalid-token' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Token inválido');
    });
  });

  describe('POST /auth/resend-verification', () => {
    it('should resend verification email', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test@example.com',
          password: 'hashed',
          username: 'testuser',
          isVerified: false,
        },
      });

      const res = await request(app)
        .post('/auth/resend-verification')
        .send({ email: 'test@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Correo de verificación enviado');

      const token = await prisma.verificationToken.findFirst({ where: { userId: user.id } });
      expect(token).toBeDefined();
    });

    it('should fail if user is verified', async () => {
      await prisma.user.create({
        data: {
          email: 'test@example.com',
          password: 'hashed',
          username: 'testuser',
          isVerified: true,
        },
      });

      const res = await request(app)
        .post('/auth/resend-verification')
        .send({ email: 'test@example.com' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Cuenta ya verificada');
    });
  });

  describe('POST /auth/login', () => {
    it('should login successfully', async () => {
      const password = 'password123';
      await prisma.user.create({
        data: {
          email: 'test@example.com',
          password: await bcrypt.hash(password, 10),
          username: 'testuser',
          isVerified: true,
        },
      });

      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'test@example.com', password });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();

      const refreshToken = await prisma.refreshToken.findFirst({ where: { user: { email: 'test@example.com' } } });
      expect(refreshToken).toBeDefined();
    });

    it('should fail with invalid credentials', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'test@example.com', password: 'wrong' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Credenciales inválidas');
    });
  });

  describe('POST /auth/refresh', () => {
    it('should refresh token successfully', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test@example.com',
          password: 'hashed',
          username: 'testuser',
        },
      });

      const refreshToken = await prisma.refreshToken.create({
        data: {
          userId: user.id,
          token: 'valid-refresh-token',
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      const res = await request(app)
        .post('/auth/refresh')
        .send({ token: 'valid-refresh-token' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();

      const oldToken = await prisma.refreshToken.findUnique({ where: { token: 'valid-refresh-token' } });
      expect(oldToken).toBeNull();
    });

    it('should fail with invalid refresh token', async () => {
      const res = await request(app)
        .post('/auth/refresh')
        .send({ token: 'invalid-refresh-token' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Token de refresco inválido');
    });
  });

  describe('GET /auth/me', () => {
    it('should get user data successfully', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test@example.com',
          password: 'hashed',
          username: 'testuser',
          name: 'Test User',
          isBusiness: false,
        },
      });

      const business = await prisma.business.create({
        data: {
          userId: user.id,
          name: 'Agenda de Test User',
        },
      });

      await prisma.worker.create({
        data: {
          businessId: business.id,
          workerName: 'Test User',
          isOwner: true,
        },
      });

      const token = jwt.sign(
        { userId: user.id, isBusiness: user.isBusiness, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.email).toBe('test@example.com');
      expect(res.body.business.name).toBe('Agenda de Test User');
      expect(res.body.worker.workerName).toBe('Test User');
    });

    it('should fail without token', async () => {
      const res = await request(app).get('/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('No autenticado');
    });
  });
});