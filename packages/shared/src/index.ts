// Public entry point of @keystone/shared.
// Every schema is exported together with its inferred TypeScript type,
// so the API (which validates) and the web app (which renders) agree on shapes.
export * from './schemas/person';
export * from './schemas/artifact';
export * from './schemas/system';
export * from './schemas/decision';
export * from './schemas/action';
export * from './schemas/api-error';
export * from './schemas/health';
export * from './schemas/ingest';
export * from './schemas/search';
export * from './schemas/analytics';
export * from './schemas/agent';
export * from './schemas/whatif';
export * from './schemas/bench';
