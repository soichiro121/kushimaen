import { completeRunRoute } from '../../../server/http/routes.js';
import { vercelFunction } from '../../../server/http/vercel.js';

export default vercelFunction(completeRunRoute());
