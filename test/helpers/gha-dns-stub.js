// Stand-in for node:dns/promises inside the Action bundle test. The bundle
// loads that module with createRequire, so the preload's resolve hook has to
// answer both require() and import.
import { lookup as realLookup } from 'node:dns/promises';

const routes = new Map([
  ['rebind.attacker.test', '127.0.0.1'],
  ['redirector.attacker.test', '93.184.216.34'],
]);

export function lookup(hostname, options) {
  const name = String(hostname).trim().toLowerCase().replace(/\.+$/, '');
  const address = routes.get(name);
  if (!address) return realLookup(hostname, options);

  const record = { address, family: 4 };
  const result = options && typeof options === 'object' && options.all ? [record] : record;
  return Promise.resolve(result);
}

export {
  Resolver,
  getDefaultResultOrder,
  getServers,
  lookupService,
  resolve,
  resolve4,
  resolve6,
  resolveAny,
  resolveCaa,
  resolveCname,
  resolveMx,
  resolveNaptr,
  resolveNs,
  resolvePtr,
  resolveSoa,
  resolveSrv,
  resolveTxt,
  reverse,
  setDefaultResultOrder,
  setServers,
} from 'node:dns/promises';
