const { env } = require("../config/env");
const { isValidPrompt, PROMPT_MAX_LENGTH } = require("../middleware/inputValidator");

/**
 * System message for Mera Lawyer AI.
 * Used by all providers: Gemini, Groq, Ollama.
 */
const SYSTEM_MESSAGE = [
  "You are **Mera Lawyer**, an expert AI legal study assistant for Indian law students.",
  "You have deep expertise in the Indian Constitution, IPC, BNS, CrPC, BNSS, Indian Evidence Act, BSA, and all major Indian statutes.",
  "",
  "CRITICAL RULES:",
  "1. READ THE QUESTION CAREFULLY. Answer EXACTLY what is asked — nothing more, nothing less.",
  "2. If asked about a specific section (e.g. Section 302 IPC), answer about THAT EXACT section correctly.",
  "   - Section 302 IPC = Murder (NOT cheating, NOT defamation).",
  "   - Section 420 IPC = Cheating. Section 499 IPC = Defamation. Section 304 IPC = Culpable Homicide.",
  "3. Start directly with the answer. No filler like 'Great question' or 'Let me explain'.",
  "4. Write like a senior law professor — authoritative, precise, factual.",
  "5. Use proper markdown formatting with ## headings and - bullet points.",
  "",
  "RESPONSE STRUCTURE (adapt sections based on the question):",
  "",
  "## 📋 Definition",
  "State what the law/section/article says in clear language. Include the exact section number and Act.",
  "",
  "## 🔑 Key Elements / Essential Ingredients",
  "- List each essential element as a bullet",
  "- Mention exceptions or provisos if any",
  "",
  "## ⚖️ Punishment / Legal Consequence",
  "State the penalty with exact imprisonment terms and fine amounts.",
  "Mention cognizable/non-cognizable, bailable/non-bailable.",
  "",
  "## 📚 Landmark Cases",
  "- **Case Name (Year)**: One-line summary",
  "",
  "## 💡 Practical Application",
  "One realistic scenario showing how this law applies.",
  "",
  "## 📝 Exam Tip",
  "One practical tip for answering this in exams.",
  "",
  "## 🔗 Related Provisions",
  "2-3 related sections/articles to study together.",
  "",
  "End with: '*Note: This is for educational purposes only.*'",
  "",
  "IMPORTANT:",
  "- If a section is replaced by BNS/BNSS, mention both old and new section numbers.",
  "- If the question is general (e.g. 'What is tort?'), adapt the structure accordingly.",
  "- If the question is not about law, politely redirect.",
].join("\n");

/* ═══════════════════════════════════════════════
 *  PROVIDER 1: Google Gemini (fast, free tier)
 *  Endpoint: generativelanguage.googleapis.com
 * ═══════════════════════════════════════════════ */
async function callGemini(userPrompt, studentName) {
  const model = env.aiModel || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.geminiApiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: SYSTEM_MESSAGE }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: `Student: ${studentName}\n\nQuestion: ${userPrompt}` }],
        },
      ],
      generationConfig: {
        maxOutputTokens: 2000,
        temperature: 0.5,
        topP: 0.9,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    const errMsg = data?.error?.message || "Gemini API returned an error.";
    throw new Error(errMsg);
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return text.trim();
}

/* ═══════════════════════════════════════════════
 *  PROVIDER 2: Groq cloud (OpenAI-compatible)
 * ═══════════════════════════════════════════════ */
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
      max_tokens: 2000,
      temperature: 0.5,
      top_p: 0.9,
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

/* ═══════════════════════════════════════════════
 *  PROVIDER 3: Ollama local
 * ═══════════════════════════════════════════════ */
async function callOllama(userPrompt, studentName) {
  const fullPrompt = [
    "/no_think",
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
        num_predict: 2000,
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

  let text = (data.response || "").trim();

  // Strip Qwen3 thinking tags: <think>...</think>
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  text = text.replace(/<think>[\s\S]*/gi, "").trim();

  if (!text) {
    throw new Error("AI model did not produce a usable response. Try again.");
  }

  return text;
}

/* ═══════════════════════════════════════════════
 *  POST /api/ai/generate
 *  Routes to Gemini / Groq / Ollama based on AI_PROVIDER
 * ═══════════════════════════════════════════════ */
async function generate(req, res) {
  try {
    const prompt = String(req.body.prompt || "").trim();

    if (!prompt) {
      return res.status(400).json({
        success: false,
        message: "Prompt is required.",
      });
    }

    if (!isValidPrompt(prompt)) {
      return res.status(400).json({
        success: false,
        message: `Prompt must be between 2 and ${PROMPT_MAX_LENGTH} characters.`,
      });
    }

    const studentName = req.user.name || "Student";
    let answer;

    try {
      if (env.aiProvider === "gemini") {
        answer = await callGemini(prompt, studentName);
      } else if (env.aiProvider === "groq") {
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
