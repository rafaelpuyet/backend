const request = require('supertest');
const app = require('../src/index');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();

beforeEach(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.business.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Appointment Routes', () => {
  let user, business, branch, appointment, token;

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
        timezone: 'America/Santiago',
      },
    });

    branch = await prisma.branch.create({
      data: {
        businessId: business.id,
        name: 'Main Branch',
      },
    });

    appointment = await prisma.appointment.create({
      data: {
        businessId: business.id,
        branchId: branch.id,
        clientName: 'Client',
        clientEmail: 'client@example.com',
        clientPhone: '123456789',
        startTime: new Date('2025-07-01T09:00:00-04:00'),
        endTime: new Date('2025-07-01T09:30:00-04:00'),
        status: 'pending',
      },
    });

    token = jwt.sign(
      { userId: user.id, isBusiness: user.isBusiness, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  });

  describe('PUT /appointments/:id', () => {
    it('should update appointment successfully', async () => {
      const res = await request(app)
        .put(`/appointments/${appointment.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          startTime: '2025-07-01T10:00:00-04:00',
          endTime: '2025-07-01T10:30:00-04:00',
          status: 'confirmed',
        });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();

      const updatedAppointment = await prisma.appointment.findUnique({ where: { id: appointment.id } });
      expect(updatedAppointment.startTime).toEqual(new Date('2025-07-01T10:00:00-04:00'));
      expect(updatedAppointment.status).toBe('confirmed');

      const auditLog = await prisma.auditLog.findFirst({ where: { entity: 'Appointment' } });
      expect(auditLog).toBeDefined();
    });

    it('should fail with invalid status transition', async () => {
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { status: 'cancelled' },
      });

      const res = await request(app)
        .put(`/appointments/${appointment.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'confirmed' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid status transition');
    });
  });

  describe('GET /audit-logs', () => {
    it('should get audit logs successfully', async () => {
      await prisma.auditLog.create({
        data: {
          action: 'create',
          entity: 'Appointment',
          entityId: appointment.id,
          userId: user.id,
        },
      });

      const res = await request(app)
        .get('/audit-logs')
        .set('Authorization', `Bearer ${token}`)
        .query({ entity: 'Appointment' });

      expect(res.status).toBe(200);
      expect(res.body.logs.length).toBe(1);
      expect(res.body.logs[0].entity).toBe('Appointment');
    });
  });
});