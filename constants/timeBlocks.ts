export const blockDurationMinutes = 5;
export const checkInGraceMinutes = 5;
export const sleepHoursPerDay = 6;

export const blocksPerHour = 60 / blockDurationMinutes;
export const blocksPerDay = 24 * blocksPerHour;
export const activeBlocksPerDay = (24 - sleepHoursPerDay) * blocksPerHour;

export const gridDurationMinutes = 30;
export const gridSegmentsPerHour = 60 / gridDurationMinutes;
export const blocksPerGridSegment = gridDurationMinutes / blockDurationMinutes;

export const calendarHours = Array.from({ length: 24 }, (_, index) => index);
