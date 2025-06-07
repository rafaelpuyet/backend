const request = require('supertest');
const app = require('../src/index');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();

beforeEach(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.worker.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.business.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Business Routes', () => {
  let user, token, business;

  beforeEach(async () => {
    user = await prisma.user.create({
      data: {
        email: 'test@example.com',
        password: 'hashed',
        username: 'testuser',
        isBusiness: true,
      },
    });

    business = await prisma.business.create({
      data: {
        userId: user.id,
        name: 'Test Business',
      },
    });

    token = jwt.sign(
      { userId: user.id, isBusiness: user.isBusiness, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  });

  describe('PUT /business/update', () => {
    it('should update business successfully', async () => {
      const res = await request(app)
        .put('/business/update')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Updated Business', timezone: 'America/Santiago' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();

      const updatedBusiness = await prisma.business.findUnique({ where: { id: business.id } });
      expect(updatedBusiness.name).toBe('Updated Business');
      expect(updatedBusiness.timezone).toBe('America/Santiago');

      const auditLog = await prisma.auditLog.findFirst({ where: { entity: 'Business' } });
      expect(auditLog).toBeDefined();
    });

    it('should fail with invalid data', async () => {
      const res = await request(app)
        .put('/business/update')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /branches', () => {
    it('should create branch successfully', async () => {
      const res = await request(app)
        .post('/branches')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'New Branch', address: '123 Street' });

      expect(res.status).toBe(200);
      expect(res.body.branch.name).toBe('New Branch');

      const auditLog = await prisma.auditLog.findFirst({ where: { entity: 'Branch' } });
      expect(auditLog).toBeDefined();
    });

    it('should fail for non-business user', async () => {
      const nonBusinessUser = await prisma.user.create({
        data: {
          email: 'nonbusiness@example.com',
          password: 'hashed',
          username: 'nonbusiness',
          isBusiness: false,
        },
      });

      const nonBusinessToken = jwt.sign(
        { userId: nonBusinessUser.id, isBusiness: false, username: nonBusinessUser.username },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      const res = await request(app)
        .post('/branches')
        .set('Authorization', `Bearer ${nonBusinessToken}`)
        .send({ name: 'New Branch' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Only businesses can create branches');
    });
  });

  describe('PUT /branches/:id', () => {
    it('should update branch successfully', async () => {
      const branch = await prisma.branch.create({
        data: { businessId: business.id, name: 'Branch 1' },
      });

      const res = await request(app)
        .put(`/branches/${branch.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Updated Branch' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Branch updated successfully');

      const updatedBranch = await prisma.branch.findUnique({ where: { id: branch.id } });
      expect(updatedBranch.name).toBe('Updated Branch');
    });

    it('should fail with invalid branch ID', async () => {
      const res = await request(app)
        .put('/branches/999')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Updated Branch' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Branch not found');
    });
  });

  describe('DELETE /branches/:id', () => {
    it('should delete branch successfully', async () => {
      const branch = await prisma.branch.create({
        data: { businessId: business.id, name: 'Branch 1' },
      });

      const res = await request(app)
        .delete(`/branches/${branch.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Branch deleted successfully');

      const deletedBranch = await prisma.branch.findUnique({ where: { id: branch.id } });
      expect(deletedBranch).toBeNull();
    });
  });

  describe('POST /workers', () => {
    it('should create worker successfully', async () => {
      const res = await request(app)
        .post('/workers')
        .set('Authorization', `Bearer ${token}`)
        .send({ workerName: 'New Worker' });

      expect(res.status).toBe(200);
      expect(res.body.worker.workerName).toBe('New Worker');

      const auditLog = await prisma.auditLog.findFirst({ where: { entity: 'Worker' } });
      expect(auditLog).toBeDefined();
    });
  });

  describe('PUT /workers/:id', () => {
    it('should update worker successfully', async () => {
      const worker = await prisma.worker.create({
        data: { businessId: business.id, workerName: 'Worker 1' },
      });

      const res = await request(app)
        .put(`/workers/${worker.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ workerName: 'Updated Worker' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Worker updated successfully');

      const updatedWorker = await prisma.worker.findUnique({ where: { id: worker.id } });
      expect(updatedWorker.workerName).toBe('Updated Worker');
    });

    it('should fail for owner worker', async () => {
      const worker = await prisma.worker.create({
        data: { businessId: business.id, workerName: 'Owner', isOwner: true },
      });

      const res = await request(app)
        .put(`/workers/${worker.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ workerName: 'Updated Owner' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Cannot modify owner worker');
    });
  });

  describe('DELETE /workers/:id', () => {
    it('should delete worker successfully', async () => {
      const worker = await prisma.worker.create({
        data: { businessId: business.id, workerName: 'Worker 1' },
      });

      const res = await request(app)
        .delete(`/workers/${worker.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Worker deleted successfully');

      const deletedWorker = await prisma.worker.findUnique({ where: { id: worker.id } });
      expect(deletedWorker).toBeNull();
    });

    it('should fail for owner worker', async () => {
      const worker = await prisma.worker.create({
        data: { businessId: business.id, workerName: 'Owner', isOwner: true },
      });

      const res = await request(app)
        .delete(`/workers/${worker.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Cannot delete owner worker');
    });
  });

  describe('POST /schedules', () => {
    it('should create schedule successfully', async () => {
      const res = await request(app)
        .post('/schedules')
        .set('Authorization', `Bearer ${token}`)
        .send({
          dayOfWeek: 1,
          startTime: '09:00:00',
          endTime: '17:00:00',
          slotDuration: 30,
        });

      expect(res.status).toBe(200);
      expect(res.body.schedule.dayOfWeek).toBe(1);

      const auditLog = await prisma.auditLog.findFirst({ where: { entity: 'Schedule' } });
      expect(auditLog).toBeDefined();
    });

    it('should fail with overlapping schedule', async () => {
      await prisma.schedule.create({
        data: {
          businessId: business.id,
          dayOfWeek: 1,
          startTime: '09:00:00',
          endTime: '17:00:00',
          slotDuration: 30,
        },
      });

      const res = await request(app)
        .post('/schedules')
        .set('Authorization', `Bearer ${token}`)
        .send({
          dayOfWeek: 1,
          startTime: '10:00:00',
          endTime: '12:00:00',
          slotDuration: 30,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Overlapping schedule exists');
    });
  });

  describe('POST /exceptions', () => {
    it('should create exception successfully', async () => {
      const res = await request(app)
        .post('/exceptions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          date: '2025-07-01',
          isClosed: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.exception.isClosed).toBe(true);

      const auditLog = await prisma.auditLog.findFirst({ where: { entity: 'Exception' } });
      expect(auditLog).toBeDefined();
    });
  });
});