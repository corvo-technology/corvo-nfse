/** The warning goes out 20 hours after an off-line NFC-e was issued... */
export const NFCE_CONTINGENCY_ALERT_AFTER_MS = 20 * 3_600_000;
/** ...and the legal limit to transmit it is 24 hours (after that the SEFAZ answers cStat 150). */
export const NFCE_CONTINGENCY_DEADLINE_MS = 24 * 3_600_000;
