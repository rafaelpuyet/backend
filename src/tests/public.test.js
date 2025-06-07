const request = require('supertest');
const app = require('../src/index');
const { PrismaClient } = require('@prisma/client');
const moment = require('moment-timezone');

const prisma = new PrismaClient();

beforeEach(async () => {
  await prisma.temporaryToken.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.availableSlots.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.worker.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.business.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Public Routes', () => {
  let user, business, branch;

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
  });

  describe('GET /public/business/:username', () => {
    it('should get business info successfully', async () => {
      const res = await request(app).get('/public/business/testuser');

      expect(res.status).toBe(200);
      expect(res.body.business.name).toBe('Test Business');
      expect(res.body.branches[0].name).toBe('Main Branch');
    });

    it('should fail if no branches for business', async () => {
      await prisma.branch.deleteMany({ where: { businessId: business.id } });

      const res = await request(app).get('/public/business/testuser');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No hay sucursales configuradas');
    });
  });

  describe('GET /public/business/:username/availability', () => {
    it('should get availability successfully', async () => {
      await prisma.availableSlots.create({
        data: {
          businessId: business.id,
          branchId: branch.id,
          date: new Date('2025-07-01'),
          startTime: '09:00:00',
          endTime: '09:30:00',
        },
      });

      const res = await request(app)
        .get('/public/business/testuser/availability')
        .query({ date: '2025-07-01' });

      expect(res.status).toBe(200);
      expect(res.body.availableSlots.length).toBe(1);
      expect(res.body.availableSlots[0].startTime).toBe('09:00:00');
    });

    it('should fail with invalid date', async () => {
      const res = await request(app)
        .get('/public/business/testuser/availability')
        .query({ date: 'invalid' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Fecha inválida');
    });
  });

  describe('POST /public/business/:username/appointments', () => {
    it('should create appointment successfully', async () => {
      await prisma.availableSlots.create({
        data: {
          businessId: business.id,
          branchId: branch.id,
          date: new Date('2025-07-01'),
          startTime: '09:00:00',
          endTime: '09:30:00',
        },
      });

      const res = await request(app)
        .post('/public/business/testuser/appointments')
        .send({
          branchId: branch.id,
          startTime: '2025-07-01T09:00:00-04:00',
          endTime: '2025-07-01T09:30:00-04:00',
          clientName: 'Client',
          clientEmail: 'client@example.com',
          clientPhone: '123456789',
        });

      expect(res.status).toBe(200);
      expect(res.body.appointmentId).toBeDefined();

      const appointment = await prisma.appointment.findUnique({ where: { id: res.body.appointmentId } });
      expect(appointment.clientName).toBe('Client');

      const auditLog = await prisma.auditLog.findFirst({ where: { entity: 'Appointment' } });
      expect(auditLog).toBeDefined();
    });

    it('should fail if slot is booked', async () => {
      await prisma.appointment.create({
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

      const res = await request(app)
        .post('/public/business/testuser/appointments')
        .send({
          branchId: branch.id,
          startTime: '2025-07-01T09:00:00-04:00',
          endTime: '2025-07-01T09:30:00-04:00',
          clientName: 'Client',
          clientEmail: 'client@example.com',
          clientPhone: '123456789',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Horario ya reservado');
    });
  });

  describe('PUT /public/appointments/:id', () => {
    it('should reschedule appointment successfully', async () => {
      const appointment = await prisma.appointment.create({
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

      const tempToken = await prisma.temporaryToken.create({
        data: {
          appointmentId: appointment.id,
          token: 'valid-token',
          clientEmail: 'client@example.com',
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      await prisma.availableSlots.create({
        data: {
          businessId: business.id,
          branchId: branch.id,
          date: new Date('2025-07-01'),
          startTime: '10:00:00',
          endTime: '10:30:00',
        },
      });

      const res = await request(app)
        .put(`/public/appointments/${appointment.id}`)
        .send({
          token: 'valid-token',
          startTime: '2025-07-01T10:00:00-04:00',
          endTime: '2025-07-01T10:30:00-04:00',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Cita reprogramada exitosamente');

      const updatedAppointment = await prisma.appointment.findUnique({ where: { id: appointment.id } });
      expect(updatedAppointment.startTime).toEqual(new Date('2025-07-01T10:00:00-04:00'));
    });
  });

  describe('DELETE /public/appointments/:id', () => {
    it('should cancel appointment successfully', async () => {
      const appointment = await prisma.appointment.create({
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

      const tempToken = await prisma.temporaryToken.create({
        data: {
          appointmentId: appointment.id,
          token: 'valid-token',
          clientEmail: 'client@example.com',
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      const res = await request(app)
        .delete(`/public/appointments/${appointment.id}`)
        .send({ token: 'valid-token' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Cita cancelada exitosamente');

      const updatedAppointment = await prisma.appointment.findUnique({ where: { id: appointment.id } });
      expect(updatedAppointment.status).toBe('cancelled');
    });
  });
});