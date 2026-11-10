import fs from 'node:fs';
import http from 'node:http';
import { registerHooks } from 'node:module';
import net from 'node:net';

const stubUrl = new URL('./gha-dns-stub.js', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL || '';
    const isDns = specifier === 'node:dns/promises' || specifier === 'dns/promises';
    if (isDns && !parent.includes('gha-dns-stub.js')) {
      return { url: stubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

// The Action process cannot reach a server owned by the test runner, so the
// fixture listens here, before the bundle starts. A public HTTP $ref is pinned
// to the address DNS returned; send that one connection to this server and
// replace the pin lookup, which would otherwise refuse the rewritten host.
const fixturePort = Number(process.env.FIXTURE_PORT);
const hitsPath = process.env.FIXTURE_HITS;
const publicPin = new Set(['redirector.attacker.test', '93.184.216.34']);

if (fixturePort && hitsPath) {
  const server = http.createServer((req, res) => {
    fs.appendFileSync(hitsPath, `${JSON.stringify({ host: req.headers.host || '', url: req.url || '' })}\n`);
    if ((req.headers.host || '').startsWith('redirector.attacker.test')) {
      res.writeHead(302, { location: `http://127.0.0.1:${fixturePort}/secret` });
      res.end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end('"MARKER-INTERNAL"');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(fixturePort, '127.0.0.1', resolve);
  });

  const original = net.connect;
  const lookup = (_hostname, opts, cb) => {
    const address = '127.0.0.1';
    const family = 4;
    if (typeof opts === 'function') {
      opts(null, address, family);
      return;
    }
    if (opts?.all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  };
  net.connect = function connect(options, ...rest) {
    if (options && typeof options === 'object' && Number(options.port) === fixturePort) {
      const host = options.host || options.hostname;
      if (publicPin.has(host)) options = { ...options, host: '127.0.0.1', lookup };
    }
    return original.call(this, options, ...rest);
  };
}
