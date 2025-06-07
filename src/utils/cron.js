const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const cleanupUnverifiedUsers = async () => {
  try {
    await prisma.$executeRaw`
      DELETE FROM "User" WHERE "isVerified" = false AND id IN (
        SELECT "userId" FROM "VerificationToken" WHERE "expiresAt" < NOW()
      ) AND "createdAt" < NOW() - INTERVAL '24 hours';
    `;
    console.log('Cleaned up unverified users');
  } catch (error) {
    console.error('Error cleaning up unverified users:', error);
  }
};

const cleanupAuditLogs = async () => {
  try {
    await prisma.auditLog.deleteMany({
      where: {
        createdAt: { lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } // 90 days
      }
    });
    console.log('Cleaned up old audit logs');
  } catch (error) {
    console.error('Error cleaning up audit logs:', error);
  }
};

const precalculateAvailableSlots = async () => {
  try {
    const tomorrow = DateTime.now().plus({ days: 1 }).startOf('day');
    const businesses = await prisma.business.findMany({ include: { schedules: true, exceptions: true, appointments: true } });

    for (const business of businesses) {
      const timezone = business.timezone || 'UTC';
      const startDate = tomorrow.toJSDate();
      const endDate = tomorrow.plus({ days: 30 }).toJSDate(); // Precalculate for 30 days

      for (let date = startDate; date <= endDate; date.setDate(date.getDate() + 1)) {
        const currentDate = DateTime.fromJSDate(date, { zone: timezone }).startOf('day');
        const dayOfWeek = currentDate.weekday % 7; // 0=Sunday, 1=Monday, etc.

        // Get relevant schedules
        const schedules = business.schedules.filter(s => s.dayOfWeek === dayOfWeek);
        const exceptions = business.exceptions.filter(e => 
          DateTime.fromJSDate(e.date).hasSame(currentDate, 'day') && e.isClosed
        );

        if (exceptions.length > 0) continue; // Skip closed days

        for (const schedule of schedules) {
          let currentTime = DateTime.fromISO(`${currentDate.toISODate()}T${schedule.startTime}`, { zone: timezone });
          const endTime = DateTime.fromISO(`${currentDate.toISODate()}T${schedule.endTime}`, { zone: timezone });

          while (currentTime < endTime) {
            const slotEnd = currentTime.plus({ minutes: schedule.slotDuration });
            const isBooked = business.appointments.some(a => 
              a.status !== 'cancelled' &&
              DateTime.fromJSDate(a.startTime).hasSame(currentTime, 'minute') &&
              (!schedule.workerId || a.workerId === schedule.workerId) &&
              (!schedule.branchId || a.branchId === schedule.branchId)
            );

            if (!isBooked) {
              await prisma.availableSlots.upsert({
                where: {
                  businessId_date_startTime: {
                    businessId: business.id,
                    date: currentDate.toJSDate(),
                    startTime: currentTime.toFormat('HH:mm:ss')
                  }
                },
                update: {},
                create: {
                  businessId: business.id,
                  branchId: schedule.branchId,
                  workerId: schedule.workerId,
                  date: currentDate.toJSDate(),
                  startTime: currentTime.toFormat('HH:mm:ss'),
                  endTime: slotEnd.toFormat('HH:mm:ss'),
                  createdAt: new Date()
                }
              });
            }

            currentTime = slotEnd;
          }
        }
      }
    }
    console.log('Precalculated available slots');
  } catch (error) {
    console.error('Error precalculating slots:', error);
  }
};

module.exports = { cleanupUnverifiedUsers, cleanupAuditLogs, precalculateAvailableSlots };