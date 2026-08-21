// Local/traditional server entry point (used by `npm start`, Docker, etc.)
// Vercel does NOT use this file — it imports the app directly via api/index.js,
// since serverless platforms manage their own listener instead of app.listen().
const app = require('./app');

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Payroll API running on http://localhost:${PORT}`);
});
