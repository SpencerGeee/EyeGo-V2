'use strict';

// Jest global setup. Keep the test environment quiet and deterministic.
// Referenced by package.json -> jest.setupFilesAfterFramework.

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// Default test timeout — most unit tests are fast; integration tests override locally.
jest.setTimeout(15000);
