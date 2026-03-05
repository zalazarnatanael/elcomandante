const request = require('supertest');
const express = require('express');

const adminRoutes = require('../../src/features/admin/admin.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', (req, res, next) => {
    req.user = { app_metadata: { role: 'admin' } };
    next();
  }, adminRoutes);
  return app;
}

jest.mock('../../src/features/admin/admin.service', () => ({
  getDashboardSummary: jest.fn(async () => ({ counts: { projects: 1, workspaces: 2, developers: 3, tasks: 4 } }))
}));

describe('admin routes', () => {
  it('GET /api/admin/summary returns summary', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/admin/summary');
    expect(res.status).toBe(200);
    expect(res.body.counts.projects).toBe(1);
  });
});
