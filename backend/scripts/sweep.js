// Manual expiry sweep (the server also runs one every 30s and on boot).
import { runExpirySweep } from '../routes/reservations.js';

const result = runExpirySweep();
console.log(`Expiry sweep: ${result.reservationsExpired} reservation(s) expired at ${result.at}`);
process.exit(0);
