// Must be set before requiring the app so the database is in-memory, even if run without `npm test`
process.env.NODE_ENV = 'test';

const {test} = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const supertest = require('supertest');
const app = require('../src/server');
const db = require('../src/db');

const request = supertest(app);

// The naughty word list is obfuscated in the source, so do the same here
const rot13 = (text) => text.replace(/[a-z]/g, (c) => String.fromCharCode((c.charCodeAt(0) - 97 + 13) % 26 + 97));
const NAUGHTY_1 = rot13('shpx');
const NAUGHTY_2 = rot13('fuvg');

const md5 = (data) => crypto.createHash('md5').update(data).digest('hex');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

const makeAsset = (content) => {
  const data = Buffer.from(content);
  return {
    data,
    md5ext: `${md5(data)}.svg`,
    sha256: sha256(data)
  };
};

const makeProjectJSON = (assets) => JSON.stringify({
  targets: [
    {
      isStage: true,
      name: 'Stage',
      costumes: assets.map((asset, i) => ({
        name: `costume${i}`,
        assetId: asset.md5ext.split('.')[0],
        md5ext: asset.md5ext,
        dataFormat: 'svg'
      })),
      sounds: []
    }
  ],
  meta: {
    semver: '3.0.0'
  }
});

const assetInformationFor = (assets) => Object.fromEntries(assets.map((asset) => [
  asset.md5ext,
  {
    sha256: asset.sha256,
    size: asset.data.byteLength
  }
]));

const createProject = async (assets, title = 'Test') => {
  const res = await request.post('/api/projects/new')
    .send({
      project: makeProjectJSON(assets),
      assetInformation: assetInformationFor(assets),
      title
    })
    .expect('Content-Type', /json/)
    .expect(200);
  return res.body;
};

const uploadAsset = (projectId, ownershipToken, asset, data = asset.data) => request
  .post(`/api/projects/${projectId}/assets/${asset.md5ext}`)
  .set('x-ownership-token', ownershipToken)
  .set('content-type', 'application/octet-stream')
  .send(data);

const uploadCompleteProject = async (assets, title) => {
  const project = await createProject(assets, title);
  for (const md5ext of project.missingMd5exts) {
    const asset = assets.find((i) => i.md5ext === md5ext);
    await uploadAsset(project.projectId, project.ownershipToken, asset).expect(200);
  }
  await request.post(`/api/projects/${project.projectId}/complete`)
    .set('x-ownership-token', project.ownershipToken)
    .expect(200);
  return project;
};

test('static pages', async () => {
  for (const path of ['/', '/privacy', '/contact', '/deleted']) {
    const res = await request.get(path)
      .expect('Content-Type', /html/)
      .expect(200);
    assert.ok(res.text.includes('is not affiliated with Scratch'));
  }
  await request.get('/style.css').expect('Content-Type', /css/).expect(200);
  await request.get('/robots.txt').expect(200);
  await request.get('/icons/green-flag-button.svg').expect(200);
  await request.get('/js/parse.js').expect('Content-Type', /javascript/).expect(200);
  await request.get('/js/vendor/jszip.min.js').expect(200);
  await request.get('/js/vendor/scaffolding-full.js').expect(200);
});

test('404', async () => {
  const page = await request.get('/does-not-exist')
    .expect('Content-Type', /html/)
    .expect(404);
  assert.ok(page.text.includes('Error 404'));

  const api = await request.get('/api/does-not-exist')
    .expect('Content-Type', /json/)
    .expect(404);
  assert.strictEqual(api.body.message, 'Not Found');
});

test('full upload flow', async () => {
  const asset = makeAsset(`<svg xmlns="http://www.w3.org/2000/svg">${Math.random()}</svg>`);
  const project = await createProject([asset], '<b>title</b>');
  assert.deepStrictEqual(project.missingMd5exts, [asset.md5ext]);

  // Not visible until complete
  await request.get(`/projects/${project.projectId}`).expect(404);
  await request.get(`/api/projects/${project.projectId}`).expect(404);

  // Can't complete with missing assets
  await request.post(`/api/projects/${project.projectId}/complete`)
    .set('x-ownership-token', project.ownershipToken)
    .expect(400);

  // Asset upload validation
  await uploadAsset(project.projectId, 'wrong', asset).expect(401);
  await request.post(`/api/projects/${project.projectId}/assets/${asset.md5ext}`)
    .set('content-type', 'application/octet-stream')
    .send(asset.data)
    .expect(400);
  const wrongData = Buffer.from(asset.data);
  wrongData[0] ^= 1;
  const mismatch = await uploadAsset(project.projectId, project.ownershipToken, asset, wrongData).expect(400);
  assert.strictEqual(mismatch.body.message, 'md5 mismatch');
  await uploadAsset(project.projectId, project.ownershipToken, asset, Buffer.concat([asset.data, Buffer.from('x')]))
    .expect(400);
  await uploadAsset(project.projectId, project.ownershipToken, asset).expect(200);
  // Already uploaded
  await uploadAsset(project.projectId, project.ownershipToken, asset).expect(400);

  await request.post(`/api/projects/${project.projectId}/complete`)
    .set('x-ownership-token', 'wrong')
    .expect(401);
  await request.post(`/api/projects/${project.projectId}/complete`)
    .set('x-ownership-token', project.ownershipToken)
    .expect(200);

  const page = await request.get(`/projects/${project.projectId}`)
    .expect('Content-Type', /html/)
    .expect(200);
  assert.ok(page.text.includes('&lt;b&gt;title&lt;/b&gt;'));
  assert.ok(!page.text.includes('<b>title</b>'));
  assert.ok(page.text.includes(asset.sha256));

  const projectData = await request.get(`/api/projects/${project.projectId}`)
    .buffer(true)
    .parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    })
    .expect(200);
  assert.strictEqual(projectData.body.toString(), makeProjectJSON([asset]));

  const assetRes = await request.get(`/api/assets/${asset.sha256}`)
    .expect('Content-Type', 'application/octet-stream')
    .expect('Cache-Control', /immutable/)
    .expect(200);
  assert.ok(Buffer.compare(assetRes.body, asset.data) === 0);

  await request.put(`/api/projects/${project.projectId}/started`).expect(200);
});

test('assets are deduplicated and garbage collected', async () => {
  const asset = makeAsset(`<svg xmlns="http://www.w3.org/2000/svg">${Math.random()}</svg>`);
  const first = await uploadCompleteProject([asset]);

  const second = await createProject([asset]);
  assert.deepStrictEqual(second.missingMd5exts, []);
  await request.post(`/api/projects/${second.projectId}/complete`)
    .set('x-ownership-token', second.ownershipToken)
    .expect(200);

  // Lying about the size of a known asset is rejected
  await request.post('/api/projects/new')
    .send({
      project: makeProjectJSON([asset]),
      assetInformation: {
        [asset.md5ext]: {
          sha256: asset.sha256,
          size: asset.data.byteLength + 1
        }
      },
      title: 'x'
    })
    .expect(400);

  await request.delete(`/api/projects/${first.projectId}`)
    .set('x-ownership-token', first.ownershipToken)
    .expect(200);
  await request.get(`/api/assets/${asset.sha256}`).expect(200);

  await request.delete(`/api/projects/${second.projectId}`)
    .set('x-ownership-token', second.ownershipToken)
    .expect(200);
  await request.get(`/api/assets/${asset.sha256}`).expect(404);
  await request.get(`/projects/${second.projectId}`).expect(404);
});

test('invalid new project requests', async () => {
  const asset = makeAsset('<svg></svg>');
  await request.post('/api/projects/new')
    .send({project: '{', assetInformation: {}, title: 'x'})
    .expect(400);
  await request.post('/api/projects/new')
    .send({project: '{"targets":[null]}', assetInformation: {}, title: 'x'})
    .expect(400);
  await request.post('/api/projects/new')
    .send({project: makeProjectJSON([asset]), assetInformation: {}, title: 'x'})
    .expect(400);
  await request.post('/api/projects/new')
    .send({project: makeProjectJSON([asset]), assetInformation: assetInformationFor([asset])})
    .expect(400);
  await request.post('/api/projects/new')
    .set('content-type', 'application/json')
    .send('not json')
    .expect('Content-Type', /json/)
    .expect(400);
  await request.post('/api/projects/new').expect(400);
});

test('naughty and long titles are replaced on creation', async () => {
  const naughty = await uploadCompleteProject([], `oh ${NAUGHTY_1}`);
  const page = await request.get(`/projects/${naughty.projectId}`).expect(200);
  assert.ok(page.text.includes('<title>Project - '));

  const long = await uploadCompleteProject([], 'a'.repeat(101));
  const longPage = await request.get(`/projects/${long.projectId}`).expect(200);
  assert.ok(longPage.text.includes('<title>Project - '));
});

test('editing project', async () => {
  const project = await uploadCompleteProject([]);
  const edit = (body, token = project.ownershipToken) => request.post(`/api/projects/${project.projectId}`)
    .set('x-ownership-token', token)
    .send(body);

  await edit({title: 'new'}, 'wrong').expect(401);
  await edit({title: NAUGHTY_2}).expect(400);
  await edit({title: 'a'.repeat(101)}).expect(400);
  await edit({description: NAUGHTY_2}).expect(400);
  await edit({description: 'a'.repeat(10001)}).expect(400);
  await edit({title: 'New title', description: '\nline one & <two>'}).expect(200);

  const page = await request.get(`/projects/${project.projectId}`).expect(200);
  assert.ok(page.text.includes('<title>New title - '));
  assert.ok(page.text.includes('\n\nline one &amp; &lt;two&gt;</textarea>'));
  assert.ok(page.text.includes('<meta name="description" content="\nline one &amp; &lt;two&gt;">'));

  await edit({description: '" onload="alert(1)'}).expect(200);
  const quotePage = await request.get(`/projects/${project.projectId}`).expect(200);
  assert.ok(quotePage.text.includes('content="&quot; onload=&quot;alert(1)"'));

  await request.delete(`/api/projects/${project.projectId}`).expect(400);
  await request.delete(`/api/projects/${project.projectId}`)
    .set('x-ownership-token', 'wrong')
    .expect(401);
});

test('reports and admin', async () => {
  const project = await uploadCompleteProject([], 'Reported project');

  await request.post(`/api/projects/${project.projectId}/report`)
    .send({body: 'a'.repeat(10001)})
    .expect(400);
  await request.post(`/api/projects/${project.projectId}/report`)
    .send({})
    .expect(400);
  await request.post('/api/projects/does-not-exist/report')
    .send({body: 'this is a report'})
    .expect(404);
  await request.post(`/api/projects/${project.projectId}/report`)
    .send({body: 'this is a <report>'})
    .expect(200);

  await request.get('/admin').expect(401);
  await request.get('/admin/reports').expect(401);
  await request.get('/admin/reports')
    .set('Cookie', 'adminToken=wrong')
    .expect(401);

  const adminToken = db.createAdminToken('test');
  const cookie = `foo=bar; adminToken=${adminToken}`;

  await request.get('/admin').set('Cookie', cookie).expect(200);
  await request.get('/admin/').set('Cookie', cookie).expect(200);
  const reports = await request.get('/admin/reports')
    .set('Cookie', cookie)
    .expect(200);
  assert.ok(reports.text.includes('this is a &lt;report&gt;'));
  const reportId = db.getAllReports().find((i) => i.projectId === project.projectId).reportId;

  // Admins get the ownership token on the project page, normal users don't
  const normalPage = await request.get(`/projects/${project.projectId}`).expect(200);
  assert.ok(!normalPage.text.includes(project.ownershipToken));
  const adminPage = await request.get(`/projects/${project.projectId}`)
    .set('Cookie', cookie)
    .expect(200);
  assert.ok(adminPage.text.includes(project.ownershipToken));

  await request.delete(`/admin/api/reports/${reportId}`).expect(401);
  await request.delete('/admin/api/reports/abc')
    .set('Cookie', cookie)
    .expect(400);
  await request.delete(`/admin/api/reports/${reportId}`)
    .set('Cookie', cookie)
    .expect(200);
  assert.ok(!db.getAllReports().some((i) => i.reportId === reportId));
});
