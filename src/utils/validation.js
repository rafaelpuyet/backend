const Joi = require('joi');

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).pattern(/[a-zA-Z0-9]/).required(),
  name: Joi.string().max(100).pattern(/^[a-zA-ZÀ-ÿ\s-]+$/).when('isBusiness', { is: false, then: Joi.required() }),
  phone: Joi.string().max(20).optional(),
  username: Joi.string().min(3).max(50).pattern(/^[a-zA-Z0-9-]+$/).required(),
  businessName: Joi.string().max(100).pattern(/^[a-zA-ZÀ-ÿ\s-]+$/).optional(),
  logo: Joi.string().max(255).optional(),
  isBusiness: Joi.boolean().default(false)
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

const userUpdateSchema = Joi.object({
  name: Joi.string().max(100).pattern(/^[a-zA-ZÀ-ÿ\s-]+$/).optional(),
  phone: Joi.string().max(20).optional()
});

const scheduleSchema = Joi.object({
  branchId: Joi.number().optional(),
  workerId: Joi.number().optional(),
  dayOfWeek: Joi.number().min(0).max(6).required(),
  startTime: Joi.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
  endTime: Joi.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
  slotDuration: Joi.number().min(5).max(120).multiple(5).required()
});

const appointmentSchema = Joi.object({
  branchId: Joi.number().optional(),
  workerId: Joi.number().optional(),
  startTime: Joi.date().required(),
  endTime: Joi.date().required(),
  clientName: Joi.string().max(100).pattern(/^[a-zA-ZÀ-ÿ\s-]+$/).required(),
  clientEmail: Joi.string().email().required(),
  clientPhone: Joi.string().max(20).required()
});

const appointmentUpdateSchema = Joi.object({
  startTime: Joi.date().optional(),
  endTime: Joi.date().optional(),
  status: Joi.string().valid('pending', 'confirmed', 'cancelled').optional()
});

module.exports = {
  registerSchema,
  loginSchema,
  userUpdateSchema,
  scheduleSchema,
  appointmentSchema,
  appointmentUpdateSchema
};