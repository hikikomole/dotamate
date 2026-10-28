Date.now = () => Number(process.env.API_QUOTA_TEST_NOW);
require('./api-quota').take('opendota', { priority: 'normal' })
  .then(result => { if (process.send) process.send(result, () => process.exit(0)); })
  .catch(error => { console.error(error); process.exit(1); });
