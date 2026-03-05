const swaggerJSDoc = require('swagger-jsdoc');

const port = Number(process.env.PORT || 3000);
const rawBaseUrl = process.env.API_BASE_URL || '';
const defaultBaseUrl = `http://localhost:${port}`;
const apiBaseUrl = rawBaseUrl
  ? (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(rawBaseUrl)
    ? rawBaseUrl
    : `http://${rawBaseUrl}`)
  : defaultBaseUrl;

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'OpenClaw Admin API',
    version: '1.0.0',
    description: 'Admin/dashboard API for OpenClaw operations'
  },
  servers: [
    { url: apiBaseUrl, description: 'API' }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      }
    }
  },
  security: [{ bearerAuth: [] }]
};

const options = {
  definition: swaggerDefinition,
  apis: ['src/features/**/*.routes.js']
};

const swaggerSpec = swaggerJSDoc(options);

module.exports = { swaggerSpec };
