const { env } = require("../config/env");

/**
 * Builds the system message for Mera Lawyer AI.
 * Used by both Groq (cloud) and Ollama (local) providers.
 */
const SYSTEM_MESSAGE = [
  "You are Mera Lawyer, an AI legal study assistant for Indian law students.",
  "",
  "STRICT RULES:",
  "1. Answer in 500 words or less. Never exceed this limit.",
  "2. Be precise and factual. No filler, no repetition, no unnecessary introductions.",
  "3. Go straight to the answer. Do not say 'Great question' or 'Let me explain'.",
  "4. Use this structure:",
  "   - Definition: What the law/section says (1-2 sentences)",
  "   - Key Elements: Bullet the essential ingredients",
  "   - Punishment/Consequence: State the penalty clearly",
  "   - Landmark Case: Name one relevant case with a one-line summary",
  "   - Study Tip: One practical exam tip",
  "5. If the topic does not fit this structure, adapt but stay concise.",
  "6. Use Indian legal terminology (IPC, CrPC, BNS, Constitution of India).",
  "7. End with: 'Note: This is for educational purposes only.'",
].join("\n");

/**
 * Call Groq cloud API (OpenAI-compatible format).
 * Free tier: 30 req/min, 6000 tokens/min.
 * Endpoint: https://api.groq.com/openai/v1/chat/completions
 */
async function callGroq(userPrompt, studentName) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.groqApiKey}`,
    },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      model: env.aiModel,
      messages: [
        { role: "system", content: SYSTEM_MESSAGE },
        { role: "user", content: `Student: ${studentName}\n\nQuestion: ${userPrompt}` },
      ],
      max_tokens: 700,
      temperature: 0.4,
      top_p: 0.85,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    const errMsg = data?.error?.message || "AI service returned an error.";
    throw new Error(errMsg);
  }

  const text = data?.choices?.[0]?.message?.content || "";
  return text.trim();
}

/**
 * Call local Ollama instance.
 * Used when AI_PROVIDER=ollama (for local development).
 */
async function callOllama(userPrompt, studentName) {
  const fullPrompt = [
    SYSTEM_MESSAGE,
    "",
    `[STUDENT: ${studentName}]`,
    `[QUESTION]: ${userPrompt}`,
  ].join("\n");

  const response = await fetch(env.ollamaApiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({
      model: env.aiModel,
      prompt: fullPrompt,
      stream: false,
      options: {
        num_predict: 700,
        temperature: 0.4,
        top_p: 0.85,
        repeat_penalty: 1.3,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    const errMsg = data?.error || "Ollama returned an error.";
    throw new Error(errMsg);
  }

  return (data.response || "").trim();
}

/**
 * POST /api/ai/generate
 * Routes to Groq (cloud) or Ollama (local) based on AI_PROVIDER env var.
 */
async function generate(req, res) {
  try {
    const prompt = String(req.body.prompt || "").trim();

    if (!prompt) {
      return res.status(400).json({
        success: false,
        message: "Prompt is required.",
      });
    }

    const studentName = req.user.name || "Student";
    let answer;

    try {
      if (env.aiProvider === "groq") {
        answer = await callGroq(prompt, studentName);
      } else {
        answer = await callOllama(prompt, studentName);
      }
    } catch (aiError) {
      console.error(`AI (${env.aiProvider}) error:`, aiError.message);
      return res.status(503).json({
        success: false,
        message: aiError.message || "AI service is unavailable right now.",
      });
    }

    if (!answer) {
      return res.status(502).json({
        success: false,
        message: "AI returned an empty response.",
      });
    }

    return res.status(200).json({
      success: true,
      answer,
    });
  } catch (error) {
    console.error("AI generate error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to generate a response right now.",
    });
  }
}

module.exports = { generate };
