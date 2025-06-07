const request = require('supertest');
const app = require('../../src/index');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();

beforeEach(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.worker.deleteMany();
  await prisma.business.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('User Routes', () => {
  let user, business, token;

  beforeEach(async () => {
    user = await prisma.user.create({
      data: {
        email: 'test@example.com',
        password: 'hashed',
        username: 'testuser',
        name: 'Test User',
        isBusiness: false,
      },
    });

    business = await prisma.business.create({
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

    token = jwt.sign(
      { userId: user.id, isBusiness: user.isBusiness, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  });

  describe('PUT /user/update', () => {
    it('should update user and sync workerName successfully', async () => {
      const res = await request(app)
        .put('/user/update')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Updated User', phone: '123456789' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();

      const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
      expect(updatedUser.name).toBe('Updated User');
      expect(updatedUser.phone).toBe('123456789');

      const worker = await prisma.worker.findFirst({ where: { businessId: business.id, isOwner: true } });
      expect(worker.workerName).toBe('Updated User');

      const auditLog = await prisma.auditLog.findFirst({ where: { entity: 'User' } });
      expect(auditLog).toBeDefined();
    });

    it('should fail with invalid data', async () => {
      const res = await request(app)
        .put('/user/update')
        .set('Authorization', `Bearer ${token}`)
        .send({ phone: 'too-long-phone-number-1234567890' });

      expect(res.status).toBe(400);
    });
  });
});