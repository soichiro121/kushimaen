import { healthRoute } from '../server/http/health.js';
import { vercelFunction } from '../server/http/vercel.js';

export default vercelFunction(healthRoute());
