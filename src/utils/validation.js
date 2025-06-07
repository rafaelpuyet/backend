const Joi = require('joi');

const emailSchema = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const schemas = {
  register: Joi.object({
    email: Joi.string().email().required().pattern(emailSchema),
    password: Joi.string().min(8).required(),
    name: Joi.string().max(100).when('isBusiness', { is: false, then: Joi.required() }),
    phone: Joi.string().max(20).optional(),
    username: Joi.string().min(3).max(50).pattern(/^[a-zA-Z0-9-]+$/).required(),
    businessName: Joi.string().max(100).optional(),
    logo: Joi.string().uri().max(255).optional(),
    isBusiness: Joi.bool().default(false),
  }),

  login: Joi.object({
    email: Joi.string().email().required().pattern(emailSchema),
    password: Joi.string().required(),
  }),

  resendVerification: Joi.object({
    email: Joi.string().email().required().pattern(emailSchema),
  }),

  refreshToken: Joi.object({
    token: Joi.string().required(),
  }),

  updateUser: Joi.object({
    name: Joi.string().max(100).optional(),
    phone: Joi.string().max(20).optional(),
  }),

  updateBusiness: Joi.object({
    name: Joi.string().max(100).optional(),
    logo: Joi.string().uri().max(255).optional(),
    timezone: Joi.string().max(50).optional(),
  }),

  createBranch: Joi.object({
    name: Joi.string().max(100).required(),
    address: Joi.string().max(255).optional(),
  }),

  updateBranch: Joi.object({
    name: Joi.string().max(100).optional(),
    address: Joi.string().max(255).optional(),
  }),

  createWorker: Joi.object({
    workerName: Joi.string().max(100).required(),
    branchId: Joi.number().integer().optional(),
  }),

  updateWorker: Joi.object({
    workerName: Joi.string().max(100).optional(),
    branchId: Joi.number().integer().optional(),
  }),

  createSchedule: Joi.object({
    branchId: Joi.number().integer().optional(),
    workerId: Joi.number().integer().optional(),
    dayOfWeek: Joi.number().integer().min(0).max(6).required(),
    startTime: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).required(),
    endTime: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).required(),
    slotDuration: Joi.number().integer().min(5).max(120).multiple(5).required(),
  }),

  createException: Joi.object({
    branchId: Joi.number().integer().optional(),
    workerId: Joi.number().integer().optional(),
    date: Joi.date().iso().required(),
    isClosed: Joi.bool().required(),
    startTime: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
    endTime: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  }),

  updateAppointment: Joi.object({
    id: Joi.number().integer().required(),
    startTime: Joi.date().iso().optional(),
    endTime: Joi.date().iso().optional(),
    status: Joi.string().valid('pending', 'confirmed', 'cancelled').optional(),
  }),

  createAppointment: Joi.object({
    branchId: Joi.number().integer().optional(),
    workerId: Joi.number().integer().optional(),
    startTime: Joi.date().iso().required(),
    endTime: Joi.date().iso().required(),
    clientName: Joi.string().max(100).required(),
    clientEmail: Joi.string().email().required().pattern(emailSchema),
    clientPhone: Joi.string().max(20).required(),
  }),

  manageAppointment: Joi.object({
    id: Joi.number().integer().required(),
    token: Joi.string().required(),
    startTime: Joi.date().iso().optional(),
    endTime: Joi.date().iso().optional(),
  }),
};

module.exports = schemas;