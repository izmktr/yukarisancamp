"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBaseDate = getBaseDate;
const JAPAN_STANDARD_TIME_OFFSET_HOURS = 9;
const BASE_DATE_START_HOUR = 5;
const HOUR_IN_MILLISECONDS = 60 * 60 * 1000;
function getBaseDate(referenceTime = new Date()) {
    const shiftedTime = new Date(referenceTime.getTime()
        + (JAPAN_STANDARD_TIME_OFFSET_HOURS - BASE_DATE_START_HOUR) * HOUR_IN_MILLISECONDS);
    const year = shiftedTime.getUTCFullYear();
    const month = String(shiftedTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(shiftedTime.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
//# sourceMappingURL=baseDate.js.map