// Vercel auto-detects this file as a serverless function and routes
// matching requests to it (see ../vercel.json for the catch-all rewrite
// that sends every path here, so the Express app's own routing/static
// file serving takes over from there).
module.exports = require('../src/app');
