import {
  getAgentRun,
  getAgentRuns,
  type AgentRunRecord,
  type MessageRecord,
} from "./agent.repository.js";

/**
 * Memory retrieval.
 *
 * We never send the user's whole history to the model. Instead:
 *   candidates (recent completed runs)
 *     -> score by relevance to the current goal
 *     -> keep the top few, within a character budget
 *     -> format as a compact context block
 *
 * This is deliberately simple (keyword overlap + recency). The
 * `scoreRun` / `selectRelevantRuns` seam is where embeddings / vector
 * search can be dropped in later without touching callers.
 */

/** How many recent completed runs are considered as candidates. */
const CANDIDATE_RUNS = 30;
/** Max runs injected into the prompt. */
const MAX_MEMORY_RUNS = 3;
/** Per-field truncation so one long answer can't eat the budget. */
const MAX_FIELD_CHARS = 600;
/** Hard cap on the whole memory block. */
const MAX_MEMORY_CHARS = 2400;
/** A run this recent is treated as part of the ongoing conversation. */
const RECENT_WINDOW_MS = 30 * 60 * 1000;
/** Minimum keyword score for an older run to be considered relevant. */
const MIN_RELEVANCE_SCORE = 0.2;

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into",
  "are", "was", "were", "you", "your", "can", "how", "what",
  "much", "many", "will", "would", "should", "could", "please",
  "use", "using", "make", "get", "give", "tell", "show", "have",
  "has", "had", "its", "not", "but", "all", "any", "out", "about",
]);

/**
 * Phrases that explicitly point back at earlier work
 * ("same approach as before", "pehle wala", ...).
 */
const FOLLOW_UP_PATTERN =
  /\b(same|again|before|earlier|previous|previously|last|above|pehle|pichle|wahi|phir se)\b/i;

export interface RunMemory {
  goal: string;
  messages: MessageRecord[];
}

/** Full memory of one specific run (goal + its messages). */
export async function getRunMemory(
  runId: string,
): Promise<RunMemory | null> {
  const run = await getAgentRun(runId);

  if (!run) {
    return null;
  }

  return {
    goal: run.goal,
    messages: run.messages,
  };
}

function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(
      (token) => token.length > 2 && !STOP_WORDS.has(token),
    );

  return new Set(tokens);
}

/** Share of the current goal's keywords that appear in a past run (0..1). */
function scoreRun(
  goalTokens: Set<string>,
  run: AgentRunRecord,
): number {
  if (goalTokens.size === 0) {
    return 0;
  }

  const runTokens = tokenize(`${run.goal} ${run.response ?? ""}`);

  let hits = 0;

  for (const token of goalTokens) {
    if (runTokens.has(token)) {
      hits++;
    }
  }

  return hits / goalTokens.size;
}

function selectRelevantRuns(
  goal: string,
  candidates: AgentRunRecord[],
  now: number,
): AgentRunRecord[] {
  const goalTokens = tokenize(goal);
  const isFollowUp = FOLLOW_UP_PATTERN.test(goal);

  // candidates are newest first.
  const scored = candidates.map((run, index) => {
    const age = now - new Date(run.createdAt).getTime();
    const isRecent = age >= 0 && age <= RECENT_WINDOW_MS;
    const keywordScore = scoreRun(goalTokens, run);

    let score = keywordScore;

    // Ongoing conversation: the latest run(s) are almost always relevant.
    if (isRecent) {
      score += 0.5;
    }

    // "same approach as before" -> the most recent run is the referent.
    if (isFollowUp && index === 0) {
      score += 1;
    }

    const qualifies =
      keywordScore >= MIN_RELEVANCE_SCORE ||
      isRecent ||
      (isFollowUp && index === 0);

    return { run, score, qualifies };
  });

  return scored
    .filter((entry) => entry.qualifies)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MEMORY_RUNS)
    .map((entry) => entry.run)
    // Present chronologically so the context reads like a conversation.
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() -
        new Date(b.createdAt).getTime(),
    );
}

function truncate(text: string): string {
  const clean = text.trim();

  return clean.length > MAX_FIELD_CHARS
    ? `${clean.slice(0, MAX_FIELD_CHARS)}…`
    : clean;
}

function formatMemory(runs: AgentRunRecord[]): string | null {
  const blocks: string[] = [];
  let total = 0;

  for (const run of runs) {
    const block =
      `User: ${truncate(run.goal)}\n` +
      `Assistant: ${truncate(run.response ?? "")}`;

    if (total + block.length > MAX_MEMORY_CHARS) {
      break;
    }

    blocks.push(block);
    total += block.length;
  }

  return blocks.length > 0 ? blocks.join("\n\n") : null;
}

/**
 * Returns a compact block of relevant earlier context for `goal`, or
 * null when nothing relevant exists. Never throws: memory is an
 * enhancement, so a failure here must not fail the run.
 */
export async function getRelevantMemory(
  goal: string,
  currentRunId: string,
): Promise<string | null> {
  try {
    const candidates = (
      await getAgentRuns({
        status: "completed",
        excludeRunId: currentRunId,
        limit: CANDIDATE_RUNS,
      })
    ).filter((run) => run.response?.trim());

    if (candidates.length === 0) {
      return null;
    }

    const relevant = selectRelevantRuns(
      goal,
      candidates,
      Date.now(),
    );

    return formatMemory(relevant);
  } catch (error) {
    console.error(
      `[memory:${currentRunId}] retrieval failed, continuing without memory:`,
      error,
    );

    return null;
  }
}
