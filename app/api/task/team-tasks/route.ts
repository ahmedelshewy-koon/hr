import { proxyTaskBridge } from '../bridge';

export async function GET(request: Request) {
  return proxyTaskBridge(request, '/api/hr/team-tasks');
}
