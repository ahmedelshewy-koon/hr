import { withDatabase } from '../../route-helpers';
import { readPublicPlans } from '../../../plans/catalog';

/** Public, unauthenticated: the active plans flagged for the landing page, public columns only. */
export async function GET() { return withDatabase('Unable to load the plans', async db =>
  Response.json({ plans: await readPublicPlans(db) }, { headers: { 'cache-control': 'public, max-age=60' } })); }
