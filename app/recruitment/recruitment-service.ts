export type JsonRecord = Record<string, unknown>;

export type JobRequirement = {
  id: number;
  category: string;
  name: string;
  description?: string | null;
  priority: string;
  weight: number;
  minimum_value?: string | null;
  notes?: string | null;
};

export type CandidateEvidence = {
  totalExperience: number | null;
  location: string;
  currentJobTitle: string;
  currentCompany: string;
  education: string[];
  skills: string[];
  languages: string[];
  certifications: string[];
  projects: string[];
  rawText: string;
};

export type RequirementMatch = {
  requirementId: number;
  name: string;
  category: string;
  weight: number;
  score: number;
  evidenceStatus: "confirmed" | "inferred" | "not_found" | "needs_verification";
  evidence: string;
  rationale: string;
};
export type MatchingThresholds = {
  strong: number;
  good: number;
  review: number;
};

const DEFAULT_THRESHOLDS: MatchingThresholds = {
  strong: 85,
  good: 70,
  review: 50,
};
const STOP_WORDS = new Set([
  "and",
  "or",
  "the",
  "a",
  "an",
  "of",
  "in",
  "to",
  "with",
  "for",
  "years",
  "year",
  "experience",
  "required",
  "preferred",
  "minimum",
  "knowledge",
  "skill",
  "skills",
  "خبرة",
  "سنوات",
  "سنة",
  "في",
  "من",
  "على",
  "أو",
  "و",
  "مطلوب",
  "يفضل",
  "مهارة",
  "مهارات",
]);
const PROTECTED_TERMS = new Set([
  "gender",
  "religion",
  "race",
  "marital",
  "photo",
  "appearance",
  "age",
  "birth",
  "born",
  "sex",
  "male",
  "female",
  "nationality",
  "ethnicity",
  "married",
  "single",
  "الجنس",
  "الديانة",
  "الدين",
  "العرق",
  "الحالة",
  "الاجتماعية",
  "الصورة",
  "العمر",
  "الميلاد",
  "الجنسية",
  "ذكر",
  "أنثى",
  "متزوج",
  "أعزب",
]);

export function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(String(value ?? "")) as T;
  } catch {
    return fallback;
  }
}
export function stringList(value: unknown) {
  const parsed = Array.isArray(value) ? value : parseJson<unknown[]>(value, []);
  return parsed
    .map((item) =>
      typeof item === "string"
        ? item
        : String(
            (item as JsonRecord)?.name || (item as JsonRecord)?.title || "",
          ),
    )
    .map((item) => item.trim())
    .filter(Boolean);
}
export function round(value: number, places = 1) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
export function validateRequirementWeights(
  requirements: Array<Pick<JobRequirement, "weight">>,
) {
  const total = round(
    requirements.reduce((sum, item) => sum + Number(item.weight || 0), 0),
    2,
  );
  if (!requirements.length)
    throw new Response("At least one structured job requirement is required", {
      status: 400,
    });
  if (Math.abs(total - 100) > 0.001)
    throw new Response(
      `Requirement weights must total 100% (current total: ${total}%)`,
      { status: 400 },
    );
  return total;
}
export function validateFairRequirements(
  requirements: Array<{
    name: string;
    description?: string | null;
    minimum_value?: string | null;
    minimumValue?: string | null;
    notes?: string | null;
  }>,
) {
  for (const requirement of requirements) {
    const value = normalize(
      `${requirement.name || ""} ${requirement.description || ""} ${requirement.minimum_value || requirement.minimumValue || ""} ${requirement.notes || ""}`,
    );
    const protectedTerm = [...PROTECTED_TERMS].find((term) =>
      value.split(" ").includes(normalize(term)),
    );
    if (protectedTerm)
      throw new Response(
        "Recruitment requirements cannot score protected or irrelevant personal characteristics",
        { status: 400 },
      );
  }
}
export function validateScorecardWeights(criteria: Array<{ weight: number }>) {
  const total = round(
    criteria.reduce((sum, item) => sum + Number(item.weight || 0), 0),
    2,
  );
  if (!criteria.length || Math.abs(total - 100) > 0.001)
    throw new Response(
      `Scorecard weights must total 100% (current total: ${total}%)`,
      { status: 400 },
    );
  return total;
}
export function classificationForScore(
  score: number,
  thresholds: MatchingThresholds = DEFAULT_THRESHOLDS,
) {
  return score >= thresholds.strong
    ? "strong_match"
    : score >= thresholds.good
      ? "good_match"
      : score >= thresholds.review
        ? "requires_review"
        : "weak_match";
}

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}+#.]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function tokens(value: unknown) {
  return [
    ...new Set(
      normalize(value)
        .split(" ")
        .filter(
          (word) =>
            word.length > 1 &&
            !STOP_WORDS.has(word) &&
            !PROTECTED_TERMS.has(word),
        ),
    ),
  ];
}
function overlapScore(needles: string[], haystack: string) {
  if (!needles.length) return 0;
  const normalized = normalize(haystack),
    matched = needles.filter((token) => normalized.includes(token));
  return round((matched.length / needles.length) * 100);
}
function evidenceText(candidate: CandidateEvidence, category: string) {
  const map: Record<string, string> = {
    technical_skills: candidate.skills.join(", "),
    domain_experience: [
      candidate.currentJobTitle,
      candidate.currentCompany,
      candidate.projects.join(", "),
      candidate.rawText,
    ].join(" · "),
    education: candidate.education.join(", "),
    certifications: candidate.certifications.join(", "),
    language: candidate.languages.join(", "),
    location: candidate.location,
    other: [
      candidate.currentJobTitle,
      candidate.currentCompany,
      candidate.projects.join(", "),
      candidate.rawText,
    ].join(" · "),
    availability: candidate.rawText,
  };
  return map[category] || candidate.rawText;
}

export function matchCandidate(
  requirements: JobRequirement[],
  candidate: CandidateEvidence,
  thresholds: MatchingThresholds = DEFAULT_THRESHOLDS,
) {
  validateRequirementWeights(requirements);
  validateFairRequirements(requirements);
  const results: RequirementMatch[] = [];
  for (const requirement of requirements) {
    let score = 0,
      evidence = "",
      status: RequirementMatch["evidenceStatus"] = "not_found",
      rationale =
        "No job-relevant evidence was found in the candidate profile or parsed CV.";
    if (requirement.category === "work_experience") {
      const minimum = Number.parseFloat(
          String(
            requirement.minimum_value ||
              requirement.description ||
              requirement.name,
          ).match(/\d+(?:\.\d+)?/)?.[0] || "0",
        ),
        actual = Number(candidate.totalExperience || 0);
      if (actual > 0 && minimum > 0) {
        score = round(Math.min(100, (actual / minimum) * 100));
        evidence = `${actual} years of total experience recorded`;
        status = actual >= minimum ? "confirmed" : "needs_verification";
        rationale =
          actual >= minimum
            ? `Recorded experience meets the ${minimum}-year minimum.`
            : `Recorded experience covers ${score}% of the ${minimum}-year minimum.`;
      } else if (actual > 0) {
        score = 100;
        evidence = `${actual} years of total experience recorded`;
        status = "confirmed";
        rationale =
          "Experience is confirmed, but the requirement has no numeric minimum.";
      }
    } else {
      const source = evidenceText(candidate, requirement.category),
        requiredTokens = tokens(
          `${requirement.name} ${requirement.minimum_value || ""}`,
        ),
        descriptionTokens = tokens(requirement.description || "");
      score = overlapScore(requiredTokens, source);
      if (!score && descriptionTokens.length)
        score = round(overlapScore(descriptionTokens, source) * 0.8);
      if (score >= 85) {
        status = "confirmed";
        evidence = source.slice(0, 500);
        rationale =
          "The candidate record contains the configured requirement terms.";
      } else if (score >= 45) {
        status = "inferred";
        evidence = source.slice(0, 500);
        rationale = `${score}% of the configured job-relevant terms were found; depth should be verified.`;
      } else if (score > 0) {
        status = "needs_verification";
        evidence = source.slice(0, 500);
        rationale =
          "Limited related evidence was found and should be verified in screening.";
      }
    }
    results.push({
      requirementId: Number(requirement.id),
      name: requirement.name,
      category: requirement.category,
      weight: Number(requirement.weight),
      score: round(score),
      evidenceStatus: status,
      evidence,
      rationale,
    });
  }
  const overall = round(
    results.reduce((sum, item) => sum + (item.score * item.weight) / 100, 0),
  );
  const strong = results
      .filter((item) => item.score >= 85)
      .map((item) => item.name),
    partial = results
      .filter((item) => item.score > 0 && item.score < 85)
      .map((item) => item.name),
    missing = results
      .filter((item) => item.score === 0)
      .map((item) => item.name);
  const concerns = results
    .filter(
      (item) =>
        item.evidenceStatus === "needs_verification" ||
        item.evidenceStatus === "inferred",
    )
    .map((item) => `${item.name}: ${item.rationale}`);
  const questions = results
    .filter((item) => item.score < 85)
    .slice(0, 8)
    .map(
      (item) =>
        `Please describe your practical experience with “${item.name}” and provide a specific example.`,
    );
  return {
    overallScore: overall,
    classification: classificationForScore(overall, thresholds),
    requirements: results,
    strongMatches: strong,
    partialMatches: partial,
    missingRequirements: missing,
    concerns,
    suggestedQuestions: questions,
  };
}

const SKILL_TERMS = [
  "javascript",
  "typescript",
  "react",
  "node.js",
  "nodejs",
  "python",
  "java",
  "c#",
  ".net",
  "sql",
  "postgresql",
  "mysql",
  "excel",
  "power bi",
  "tableau",
  "aws",
  "azure",
  "docker",
  "kubernetes",
  "figma",
  "salesforce",
  "sap",
  "recruitment",
  "accounting",
  "marketing",
  "project management",
  "agile",
  "scrum",
  "تحليل البيانات",
  "إدارة المشاريع",
  "المبيعات",
  "التسويق",
  "المحاسبة",
  "التوظيف",
];
const LANGUAGE_TERMS = [
  ["arabic", "Arabic"],
  ["english", "English"],
  ["french", "French"],
  ["german", "German"],
  ["spanish", "Spanish"],
  ["العربية", "العربية"],
  ["الإنجليزية", "الإنجليزية"],
  ["الفرنسية", "الفرنسية"],
] as const;

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
function extractLines(text: string, pattern: RegExp, limit = 20) {
  return unique(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => pattern.test(line)),
  ).slice(0, limit);
}
export function parseCvText(raw: string) {
  const text = raw
      // PostgreSQL text columns cannot store NUL, and extracted CV bytes often carry it.
      // eslint-disable-next-line no-control-regex -- stripping NUL is the intent here
      .replace(/\u0000/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "",
    phone = text.match(/(?:\+?\d[\d ()-]{7,}\d)/)?.[0]?.trim() || "";
  const name =
    lines.find(
      (line) =>
        line.length >= 3 &&
        line.length <= 80 &&
        !/@|curriculum|resume|cv|سيرة ذاتية|\d{4}/i.test(line),
    ) || "";
  const explicitYears = [
    ...text.matchAll(
      /(\d+(?:\.\d+)?)\s*(?:\+\s*)?(?:years?|yrs?|سنوات|سنة)\s+(?:of\s+)?experience/gi,
    ),
  ].map((match) => Number(match[1]));
  const dateRanges = [
    ...text.matchAll(
      /\b((?:19|20)\d{2})\s*(?:-|–|—|to|حتى)\s*((?:19|20)\d{2}|present|current|الآن|حتى الآن)\b/gi,
    ),
  ].map((match) => {
    const start = Number(match[1]),
      end = /\d{4}/.test(match[2])
        ? Number(match[2])
        : new Date().getFullYear();
    return Math.max(0, end - start);
  });
  const totalExperience = explicitYears.length
    ? Math.max(...explicitYears)
    : dateRanges.length
      ? Math.min(
          50,
          round(
            dateRanges.reduce((sum, value) => sum + value, 0),
            1,
          ),
        )
      : null;
  const normalized = normalize(text),
    skills = unique(
      SKILL_TERMS.filter((skill) => normalized.includes(normalize(skill))),
    ),
    languages = unique(
      LANGUAGE_TERMS.filter(([term]) =>
        normalized.includes(normalize(term)),
      ).map(([, label]) => label),
    );
  const education = extractLines(
      text,
      /bachelor|master|phd|diploma|university|college|بكالوريوس|ماجستير|دكتوراه|دبلوم|جامعة|كلية/i,
    ),
    certifications = extractLines(
      text,
      /certif|certificate|certified|pmp|cpa|cfa|shrm|شهادة|معتمد/i,
    ),
    projects = extractLines(text, /project|مشروع/i);
  const employmentHistory = extractLines(
      text,
      /(?:19|20)\d{2}|present|current|الآن/i,
      40,
    ),
    jobTitle =
      extractLines(
        text,
        /manager|engineer|developer|analyst|specialist|consultant|director|lead|مدير|مهندس|مطور|محلل|أخصائي|استشاري|قائد/i,
        1,
      )[0] || "";
  const found = [
      name,
      email,
      phone,
      totalExperience,
      education.length,
      skills.length,
      languages.length,
      employmentHistory.length,
    ].filter(Boolean).length,
    confidence = round(Math.min(0.96, 0.35 + found * 0.075), 2);
  return {
    name,
    email,
    phone,
    totalExperience,
    currentJobTitle: jobTitle,
    employmentHistory,
    education,
    skills,
    languages,
    certifications,
    projects,
    relevantKeywords: unique([...skills, ...languages]),
    confidence,
  };
}

export async function extractCvText(bytes: Uint8Array, mime: string) {
  if (mime === "application/pdf") {
    const { extractText } = await import("unpdf");
    const result = await extractText(bytes, { mergePages: true });
    return String(result.text || "");
  }
  if (
    mime ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const mammoth = (await import("mammoth")).default;
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    return (
      await mammoth.extractRawText({ arrayBuffer: buffer as ArrayBuffer })
    ).value;
  }
  if (mime === "text/plain")
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  throw new Error("Only PDF, DOCX, and TXT CV files are supported");
}

export function validateCvFile(
  bytes: Uint8Array,
  filename: string,
  declaredMime: string,
  maxBytes = 12 * 1024 * 1024,
) {
  if (!bytes.length) throw new Error("The CV file is empty");
  if (bytes.length > maxBytes)
    throw new Error("CV file exceeds the 12 MB limit");
  const lower = filename.toLocaleLowerCase(),
    pdf =
      bytes.length >= 5 &&
      String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-",
    docx =
      bytes.length >= 4 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      lower.endsWith(".docx"),
    txt =
      lower.endsWith(".txt") &&
      (!declaredMime || declaredMime === "text/plain");
  const mime = pdf
    ? "application/pdf"
    : docx
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : txt
        ? "text/plain"
        : "";
  if (!mime)
    throw new Error("Only genuine PDF, DOCX, and TXT CV files are supported");
  if (
    declaredMime &&
    declaredMime !== "application/octet-stream" &&
    declaredMime !== mime
  )
    throw new Error("CV file content does not match its declared type");
  return mime;
}

export function safeCandidateObjectKey(candidateId: number, mime: string) {
  const extension =
    mime === "application/pdf" ? "pdf" : mime === "text/plain" ? "txt" : "docx";
  return `candidate-documents/${candidateId}/cv/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
}

export function candidateEvidence(
  row: JsonRecord,
  parsed: JsonRecord = {},
): CandidateEvidence {
  return {
    totalExperience:
      Number(row.total_experience ?? parsed.totalExperience) || null,
    location: String(row.location || parsed.location || ""),
    currentJobTitle: String(
      row.current_job_title || parsed.currentJobTitle || "",
    ),
    currentCompany: String(row.current_company || parsed.currentCompany || ""),
    education: stringList(row.education_json).length
      ? stringList(row.education_json)
      : stringList(parsed.education),
    skills: stringList(row.skills_json).length
      ? stringList(row.skills_json)
      : stringList(parsed.skills),
    languages: stringList(row.languages_json).length
      ? stringList(row.languages_json)
      : stringList(parsed.languages),
    certifications: stringList(row.certifications_json).length
      ? stringList(row.certifications_json)
      : stringList(parsed.certifications),
    projects: stringList(row.projects_json).length
      ? stringList(row.projects_json)
      : stringList(parsed.projects),
    rawText: String(parsed.rawText || row.raw_text || ""),
  };
}

export function consolidateEvaluations(
  stages: Array<{
    id: number;
    name: string;
    aggregationWeight: number;
    evaluations: Array<{
      overallScore: number;
      submitted: boolean;
      required: boolean;
    }>;
  }>,
  cvMatch: number,
  weights = { cvWeight: 40, interviewWeight: 60 },
) {
  const stageResults = stages.map((stage) => {
    const required = stage.evaluations.filter((item) => item.required),
      submitted = stage.evaluations.filter((item) => item.submitted),
      complete =
        required.length > 0 && required.every((item) => item.submitted),
      score = submitted.length
        ? round(
            submitted.reduce((sum, item) => sum + item.overallScore, 0) /
              submitted.length,
          )
        : null;
    return {
      id: stage.id,
      name: stage.name,
      weight: stage.aggregationWeight,
      score,
      complete,
      submitted: submitted.length,
      required: required.length,
    };
  });
  const scorable = stageResults.filter((item) => item.score !== null),
    weightTotal = scorable.reduce((sum, item) => sum + item.weight, 0),
    interviewScore = weightTotal
      ? round(
          scorable.reduce(
            (sum, item) => sum + Number(item.score) * item.weight,
            0,
          ) / weightTotal,
        )
      : null,
    allRequiredComplete =
      stageResults.length > 0 && stageResults.every((item) => item.complete);
  const decisionSupportScore =
    interviewScore === null
      ? null
      : round(
          (cvMatch * weights.cvWeight +
            interviewScore * weights.interviewWeight) /
            (weights.cvWeight + weights.interviewWeight),
        );
  return {
    stageResults,
    interviewScore,
    cvMatch: round(cvMatch),
    decisionSupportScore,
    allRequiredComplete,
    formula: {
      cvWeight: weights.cvWeight,
      interviewWeight: weights.interviewWeight,
      stageAggregation: "weighted mean of submitted independent evaluations",
    },
  };
}
