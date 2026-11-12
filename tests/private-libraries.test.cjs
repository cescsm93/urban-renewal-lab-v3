const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'renewal-library-'));
process.env.RENEWAL_DATA_DIR = directory;
const handler = require('../lib/private-libraries.cjs');
fs.writeFileSync(path.join(directory, 'partner-library.json'), JSON.stringify({
  kind: 'partner-library', records: [{ '机构名称': '示例机构' }]
}));

function request({ authorized = false, origin, url = '/api/partner-library', method = 'GET' } = {}) {
  let status, payload;
  handler({ method, url, privateLibraryAuthorized: authorized,
    headers: { host: '10.0.0.5:4189', ...(origin ? { origin } : {}) },
    socket: { remoteAddress: '10.0.0.6' } }, {
    writeHead(code) { status = code; },
    end(body) { payload = JSON.parse(body); }
  });
  return { status, payload };
}

try {
  assert.equal(request().status, 403);
  assert.equal(request({ authorized: true, origin: 'https://other.example' }).status, 403);
  assert.equal(request({ authorized: true }).status, 200);
  assert.equal(request({ authorized: true }).payload.records[0]['机构名称'], '示例机构');
  assert.deepEqual(request({ authorized: true, url: '/api/scenario-library' }).payload.records, []);
  assert.equal(request({ authorized: true, method: 'POST' }).status, 405);
  console.log('private libraries access tests passed');
} finally {
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  if (!path.resolve(directory).startsWith(tempRoot) || !path.basename(directory).startsWith('renewal-library-')) {
    throw Error('Unexpected test directory');
  }
  fs.rmSync(directory, { recursive: true, force: true });
}
