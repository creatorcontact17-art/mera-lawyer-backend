const crypto = require("crypto");

const { getMcqBundle } = require("./contentController");
const { isValidAttemptId, isValidSubmitReason } = require("../middleware/inputValidator");

const EXAM_DURATION_MS = 120 * 60 * 1000;
const COUNTDOWN_MS = 10 * 1000;
const TOTAL_QUESTIONS = 120;
const MARKS_PER_CORRECT = 1;
const NEGATIVE_MARKS = 0.25;
const ATTEMPT_RETENTION_MS = EXAM_DURATION_MS + COUNTDOWN_MS + (24 * 60 * 60 * 1000);

const EXAM_BLUEPRINT = [
  {
    id: "english",
    title: "English",
    focus: "Reading",
    keyTopics: "Inference, Tone, Vocabulary",
    questionCount: 24,
    sourceIds: ["reading-comprehension", "vocabulary", "grammar", "verbal-ability"],
  },
  {
    id: "gk",
    title: "GK",
    focus: "Current Affairs",
    keyTopics: "Legal + National News",
    questionCount: 28,
    sourceIds: [
      "current-affairs",
      "polity-and-governance",
      "legal-current-affairs",
      "international-affairs",
      "economy",
      "science-and-technology",
      "awards-and-honors",
      "sports",
      "history",
      "geography",
      "polity",
      "economics",
      "science",
    ],
  },
  {
    id: "legal",
    title: "Legal",
    focus: "Logic + Law",
    keyTopics: "Torts, Principles",
    questionCount: 32,
    sourceIds: [
      "contract-law",
      "law-of-torts",
      "criminal-law",
      "constitutional-law",
      "family-law",
      "legal-maxims",
      "legal-reasoning-skills",
      "legal-awareness",
    ],
  },
  {
    id: "logical",
    title: "Logical",
    focus: "Critical Thinking",
    keyTopics: "Arguments, Assumptions",
    questionCount: 24,
    sourceIds: ["critical-reasoning", "analytical-reasoning", "passage-based-reasoning"],
  },
  {
    id: "quant",
    title: "Quant",
    focus: "DI + Math",
    keyTopics: "Percentages, Charts",
    questionCount: 12,
    sourceIds: ["arithmetic", "data-interpretation", "mathematical-reasoning"],
  },
];

const attemptStore = new Map();

function setPrivateResponseHeaders(res) {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.set("Pragma", "no-cache");
}

function getClientConfig() {
  return {
    durationMs: EXAM_DURATION_MS,
    countdownMs: COUNTDOWN_MS,
    totalQuestions: TOTAL_QUESTIONS,
    marksPerCorrect: MARKS_PER_CORRECT,
    negativeMarks: NEGATIVE_MARKS,
    blueprint: EXAM_BLUEPRINT.map((section) => ({
      id: section.id,
      title: section.title,
      focus: section.focus,
      keyTopics: section.keyTopics,
      questionCount: section.questionCount,
    })),
  };
}

function pruneAttempts() {
  const now = Date.now();

  attemptStore.forEach((attempt, attemptId) => {
    const completedAt = attempt.submittedAt || attempt.createdAt;
    if ((now - completedAt) > ATTEMPT_RETENTION_MS) {
      attemptStore.delete(attemptId);
    }
  });
}

function answerLetterToIndex(answer) {
  const normalized = String(answer || "").trim().toUpperCase();
  return ["A", "B", "C", "D"].indexOf(normalized);
}

function randomNumber() {
  return crypto.randomInt(0, 1_000_000_000) / 1_000_000_000;
}

function createAttemptId() {
  return `ts_${crypto.randomUUID().replace(/-/g, "")}`;
}

function createNumberRange(count) {
  const list = [];
  for (let index = 0; index < count; index += 1) {
    list.push(index);
  }
  return list;
}

function shuffleArray(list) {
  const copy = list.slice();

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(randomNumber() * (index + 1));
    const temp = copy[index];
    copy[index] = copy[swapIndex];
    copy[swapIndex] = temp;
  }

  return copy;
}

function buildSourceQuestionMap(bundle) {
  const map = new Map();
  const sections = bundle && Array.isArray(bundle.sections) ? bundle.sections : [];

  sections.forEach((section) => {
    const refs = [];
    const questions = Array.isArray(section.questions) ? section.questions : [];

    questions.forEach((question, questionIndex) => {
      refs.push({
        key: `${section.id}::${questionIndex}`,
        sourceId: section.id,
        sourceTitle: section.title,
        questionIndex,
        question,
        correctIndex: answerLetterToIndex(question.answer),
      });
    });

    map.set(section.id, refs);
  });

  return map;
}

function selectQuestionsForSection(sectionBlueprint, sourceQuestionMap) {
  const sourcePools = shuffleArray(sectionBlueprint.sourceIds.slice())
    .map((sourceId) => ({
      sourceId,
      index: 0,
      refs: shuffleArray((sourceQuestionMap.get(sourceId) || []).slice()),
    }))
    .filter((pool) => pool.refs.length > 0);

  const totalAvailable = sourcePools.reduce((sum, pool) => sum + pool.refs.length, 0);
  if (totalAvailable < sectionBlueprint.questionCount) {
    throw new Error(`Not enough questions available for ${sectionBlueprint.title}.`);
  }

  const selected = [];
  let cursor = 0;

  while (selected.length < sectionBlueprint.questionCount) {
    let pickedRef = null;
    let scanned = 0;

    while (scanned < sourcePools.length) {
      const pool = sourcePools[cursor];
      cursor = (cursor + 1) % sourcePools.length;
      scanned += 1;

      if (pool.index >= pool.refs.length) {
        continue;
      }

      pickedRef = pool.refs[pool.index];
      pool.index += 1;
      break;
    }

    if (!pickedRef) {
      break;
    }

    selected.push(pickedRef);
  }

  if (selected.length < sectionBlueprint.questionCount) {
    throw new Error(`Could only generate ${selected.length} questions for ${sectionBlueprint.title}.`);
  }

  return selected;
}

function createAttemptRecord(userId) {
  const bundle = getMcqBundle();
  const sourceQuestionMap = buildSourceQuestionMap(bundle);
  const answerKey = new Map();
  const sections = [];
  const questions = [];
  let runningQuestionIndex = 0;

  EXAM_BLUEPRINT.forEach((sectionBlueprint) => {
    const selectedRefs = shuffleArray(selectQuestionsForSection(sectionBlueprint, sourceQuestionMap));
    const startIndex = runningQuestionIndex;

    selectedRefs.forEach((ref, sectionQuestionIndex) => {
      const optionCount = Array.isArray(ref.question.options) ? ref.question.options.length : 0;
      const optionOrder = shuffleArray(createNumberRange(optionCount));
      const randomizedOptions = optionOrder.map((originalIndex) => ref.question.options[originalIndex]);
      const correctDisplayIndex = optionOrder.indexOf(ref.correctIndex);

      if (correctDisplayIndex < 0) {
        throw new Error(`Question answer key is invalid for ${ref.key}.`);
      }

      const attemptQuestionId = `aq_${runningQuestionIndex + 1}_${crypto.randomInt(1000, 9999)}`;

      answerKey.set(attemptQuestionId, correctDisplayIndex);
      questions.push({
        attemptQuestionId,
        sourceId: ref.sourceId,
        sourceTitle: ref.sourceTitle,
        sectionId: sectionBlueprint.id,
        sectionTitle: sectionBlueprint.title,
        sectionFocus: sectionBlueprint.focus,
        sectionKeyTopics: sectionBlueprint.keyTopics,
        globalQuestionNumber: runningQuestionIndex + 1,
        sectionQuestionNumber: sectionQuestionIndex + 1,
        prompt: ref.question.prompt || "",
        stem: ref.question.stem || "",
        passage: ref.question.passage || "",
        options: randomizedOptions,
      });

      runningQuestionIndex += 1;
    });

    sections.push({
      id: sectionBlueprint.id,
      title: sectionBlueprint.title,
      focus: sectionBlueprint.focus,
      keyTopics: sectionBlueprint.keyTopics,
      questionCount: selectedRefs.length,
      startIndex,
      endIndex: runningQuestionIndex - 1,
    });
  });

  if (questions.length !== TOTAL_QUESTIONS) {
    throw new Error(`Expected ${TOTAL_QUESTIONS} questions, but generated ${questions.length}.`);
  }

  const createdAt = Date.now();

  return {
    attemptId: createAttemptId(),
    userId,
    status: "countdown",
    createdAt,
    countdownEndsAt: createdAt + COUNTDOWN_MS,
    startedAt: null,
    endsAt: null,
    submittedAt: null,
    submitReason: "",
    sections,
    questions,
    answerKey,
    result: null,
  };
}

function sanitizeAttemptForClient(attempt) {
  return {
    version: 3,
    attemptId: attempt.attemptId,
    status: attempt.status,
    createdAt: attempt.createdAt,
    countdownEndsAt: attempt.countdownEndsAt,
    startedAt: attempt.startedAt,
    endsAt: attempt.endsAt,
    submittedAt: attempt.submittedAt,
    submitReason: attempt.submitReason,
    currentIndex: 0,
    navigatorCollapsed: true,
    answers: {},
    marked: {},
    visited: {},
    securityEvents: [],
    sections: attempt.sections,
    questions: attempt.questions,
    result: attempt.result,
  };
}

function findAttemptForUser(attemptId, userId) {
  const attempt = attemptStore.get(String(attemptId || ""));

  if (!attempt) {
    return null;
  }

  if (String(attempt.userId) !== String(userId)) {
    return null;
  }

  return attempt;
}

function normalizeAnswers(rawAnswers) {
  if (!rawAnswers || typeof rawAnswers !== "object" || Array.isArray(rawAnswers)) {
    return {};
  }

  const normalized = {};

  Object.keys(rawAnswers).forEach((attemptQuestionId) => {
    const parsed = Number(rawAnswers[attemptQuestionId]);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 3) {
      normalized[attemptQuestionId] = parsed;
    }
  });

  return normalized;
}

function computeResult(attempt, answers) {
  const sectionStats = attempt.sections.map((section) => ({
    id: section.id,
    title: section.title,
    questionCount: section.questionCount,
    attempted: 0,
    correct: 0,
    wrong: 0,
    unattempted: 0,
    score: 0,
  }));

  const sectionMap = new Map(sectionStats.map((section) => [section.id, section]));
  let correct = 0;
  let wrong = 0;
  let attempted = 0;

  attempt.questions.forEach((question) => {
    const section = sectionMap.get(question.sectionId);
    if (!section) {
      return;
    }

    const selected = answers[question.attemptQuestionId];
    if (typeof selected === "undefined") {
      section.unattempted += 1;
      return;
    }

    attempted += 1;
    section.attempted += 1;

    if (selected === attempt.answerKey.get(question.attemptQuestionId)) {
      correct += 1;
      section.correct += 1;
      return;
    }

    wrong += 1;
    section.wrong += 1;
  });

  sectionStats.forEach((section) => {
    section.score = section.correct * MARKS_PER_CORRECT - section.wrong * NEGATIVE_MARKS;
  });

  const score = correct * MARKS_PER_CORRECT - wrong * NEGATIVE_MARKS;
  const accuracy = attempted ? (correct / attempted) * 100 : 0;

  return {
    attempted,
    correct,
    wrong,
    unattempted: TOTAL_QUESTIONS - attempted,
    score,
    accuracy,
    sections: sectionStats,
  };
}

function getConfigHandler(req, res) {
  setPrivateResponseHeaders(res);

  return res.status(200).json({
    success: true,
    config: getClientConfig(),
  });
}

function createAttemptHandler(req, res) {
  try {
    pruneAttempts();

    const attempt = createAttemptRecord(req.user._id);
    attemptStore.set(attempt.attemptId, attempt);
    setPrivateResponseHeaders(res);

    return res.status(201).json({
      success: true,
      config: getClientConfig(),
      attempt: sanitizeAttemptForClient(attempt),
    });
  } catch (error) {
    console.error("Test series attempt creation error:", error);
    return res.status(500).json({
      success: false,
      message: "Test series could not be generated right now.",
    });
  }
}

function getAttemptHandler(req, res) {
  pruneAttempts();

  const attemptId = String(req.params.attemptId || "").trim();
  if (!isValidAttemptId(attemptId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid attempt ID format.",
    });
  }

  const attempt = findAttemptForUser(attemptId, req.user._id);
  if (!attempt) {
    return res.status(404).json({
      success: false,
      message: "Test attempt was not found.",
    });
  }

  setPrivateResponseHeaders(res);

  return res.status(200).json({
    success: true,
    config: getClientConfig(),
    attempt: sanitizeAttemptForClient(attempt),
  });
}

function submitAttemptHandler(req, res) {
  pruneAttempts();

  const attemptId = String(req.params.attemptId || "").trim();
  if (!isValidAttemptId(attemptId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid attempt ID format.",
    });
  }

  const attempt = findAttemptForUser(attemptId, req.user._id);
  if (!attempt) {
    return res.status(404).json({
      success: false,
      message: "Test attempt was not found.",
    });
  }

  if (attempt.status === "submitted" && attempt.result) {
    setPrivateResponseHeaders(res);
    return res.status(200).json({
      success: true,
      attempt: sanitizeAttemptForClient(attempt),
      result: attempt.result,
    });
  }

  const answers = normalizeAnswers(req.body && req.body.answers);
  const rawReason = String((req.body && req.body.reason) || "manual").trim().toLowerCase();
  const reason = isValidSubmitReason(rawReason) ? rawReason : "manual";

  attempt.status = "submitted";
  attempt.startedAt = attempt.startedAt || attempt.countdownEndsAt;
  attempt.endsAt = attempt.endsAt || (attempt.startedAt + EXAM_DURATION_MS);
  attempt.submittedAt = Date.now();
  attempt.submitReason = reason;
  attempt.result = computeResult(attempt, answers);

  setPrivateResponseHeaders(res);

  return res.status(200).json({
    success: true,
    attempt: sanitizeAttemptForClient(attempt),
    result: attempt.result,
  });
}

module.exports = {
  createAttemptHandler,
  getAttemptHandler,
  getConfigHandler,
  submitAttemptHandler,
};
