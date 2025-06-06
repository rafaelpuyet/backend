const request = require('supertest');
const app = require('../src/index');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

describe('POST /auth/register', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should register a new user', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({
        email: 'test@example.com',
        password: 'Password123',
        name: 'Test User',
        username: 'testuser',
        isBusiness: false
      });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('should fail with duplicate username', async () => {
    await prisma.user.create({
      data: {
        email: 'other@example.com',
        password: 'hashed',
        username: 'testuser'
      }
    });
    const res = await request(app)
      .post('/auth/register')
      .send({
        email: 'test@example.com',
        password: 'Password123',
        name: 'Test User',
        username: 'testuser',
        isBusiness: false
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('username already exists');
  });

  it('should fail with invalid username', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({
        email: 'test@example.com',
        password: 'Password123',
        name: 'Test User',
        username: 'test user', // Espacio no permitido
        isBusiness: false
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('username');
  });
});