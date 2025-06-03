// server/src/utils/scheduleUtils.js
const generateTimeSlots = (startTime, endTime, slotDuration, blocks = [], exceptions = [], appointments = []) => {
  const slots = [];
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  let currentTime = new Date(0, 0, 0, startHour, startMinute);

  const endTimeDate = new Date(0, 0, 0, endHour, endMinute);

  while (currentTime < endTimeDate) {
    const slotStart = currentTime.toTimeString().slice(0, 5); // e.g., "09:00"
    currentTime = new Date(currentTime.getTime() + slotDuration * 60000);
    const slotEnd = currentTime.toTimeString().slice(0, 5); // e.g., "09:45"

    // Check if slot is blocked
    const isBlocked = blocks.some(block => {
      const [blockStartHour, blockStartMinute] = block.start_time.split(':').map(Number);
      const [blockEndHour, blockEndMinute] = block.end_time.split(':').map(Number);
      const blockStart = new Date(0, 0, 0, blockStartHour, blockStartMinute);
      const blockEnd = new Date(0, 0, 0, blockEndHour, blockEndMinute);
      const slotStartDate = new Date(0, 0, 0, ...slotStart.split(':').map(Number));
      return slotStartDate >= blockStart && slotStartDate < blockEnd;
    });

    // Check if slot is overridden by an exception
    const exception = exceptions.find(ex => {
      if (ex.type === 'custom') {
        const [exStartHour, exStartMinute] = ex.start_time.split(':').map(Number);
        const [exEndHour, exEndMinute] = ex.end_time.split(':').map(Number);
        const exStart = new Date(0, 0, 0, exStartHour, exStartMinute);
        const exEnd = new Date(0, 0, 0, exEndHour, exEndMinute);
        const slotStartDate = new Date(0, 0, 0, ...slotStart.split(':').map(Number));
        return slotStartDate >= exStart && slotStartDate < exEnd;
      }
      return false;
    });

    // Check if slot is booked
    const isBooked = appointments.some(appt => {
      const apptStart = new Date(appt.start_time).toTimeString().slice(0, 5);
      const apptEnd = new Date(appt.end_time).toTimeString().slice(0, 5);
      return slotStart >= apptStart && slotStart < apptEnd;
    });

    if (!isBlocked && !isBooked && (!exception || exception.type === 'custom')) {
      slots.push({ start_time: slotStart, end_time: slotEnd });
    }
  }

  return slots;
};

module.exports = { generateTimeSlots };