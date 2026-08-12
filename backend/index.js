'use strict';

const app = require('./src/app');
const logger = require('./src/config/logger');
const env = require('./src/config/env');

const PORT = env.PORT || 3000;

const server = app().listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
