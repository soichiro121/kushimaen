import { createRunRoute } from '../../server/http/routes.js';
import { vercelFunction } from '../../server/http/vercel.js';

export default vercelFunction(createRunRoute());
