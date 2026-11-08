// Usage: node tools/create-admin-token.js "name of person"
// Then set the printed token as the "adminToken" cookie on the site.
const db = require('../src/db');

const name = process.argv[2];
if (!name) {
  console.error('Usage: node tools/create-admin-token.js <name>');
  process.exit(1);
}

console.log(db.createAdminToken(name));
