const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const { supabaseAuthMiddleware } = require('./shared/middlewares/supabaseAuth');
const projectRoutes = require('./features/projects/project.routes');
const workspaceRoutes = require('./features/workspaces/workspace.routes');
const projectWorkspaceRoutes = require('./features/workspaces/projectWorkspace.routes');
const taskRoutes = require('./features/tasks/task.routes');
const developerRoutes = require('./features/developers/developer.routes');
const adminRoutes = require('./features/admin/admin.routes');
const webhookRoutes = require('./features/webhooks/webhook.routes');
const webhookService = require('./features/webhooks/webhook.service');
const swaggerUi = require('swagger-ui-express');
const { swaggerSpec } = require('./shared/config/swagger');

const app = express();
const port = Number(process.env.PORT || 3000);

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'https://v0-git-hub-bot-dashboard.vercel.app'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  }
}));

app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/docs.json', (req, res) => {
  res.json(swaggerSpec);
});

app.use('/docs', swaggerUi.serve);
app.get(['/docs', '/docs/'], swaggerUi.setup(swaggerSpec, {
  explorer: true,
  swaggerOptions: {
    url: '/docs.json'
  }
}));

// Webhooks are public (signature validation is enforced in route)
app.use('/webhook', webhookRoutes);

// Supabase auth for all other routes (frontend access)
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  if (req.path.startsWith('/uploads')) return next();
  if (req.path.startsWith('/docs')) return next();
  return supabaseAuthMiddleware()(req, res, next);
});

app.use('/api/projects', projectRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/project-workspaces', projectWorkspaceRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/developers', developerRoutes);
app.use('/api/admin', adminRoutes);

webhookService.startBackgroundJobs();

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
