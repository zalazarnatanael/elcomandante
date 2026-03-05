const swaggerJSDoc = require('swagger-jsdoc');

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'OpenClaw Admin API',
    version: '1.0.0',
    description: 'Admin/dashboard API for OpenClaw operations'
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Local' }
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
