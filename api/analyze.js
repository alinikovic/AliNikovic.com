const { analyzeQueryInput } = require("../server");

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const input = String(request.body?.query || "").trim();

  try {
    const result = await analyzeQueryInput(input);
    response.status(result.status).json(result.payload);
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: "Something went wrong on the server." });
  }
};
