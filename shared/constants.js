# Shared constants for both frontend and backend
# Copied into each via build. Kept here as reference/source of truth.

JUDGE0_STATUS = {
  IN_QUEUE: 1,
  PROCESSING: 2,
  ACCEPTED: 3,
  WRONG_ANSWER: 4,
  TIME_LIMIT_EXCEEDED: 5,
  COMPILATION_ERROR: 6,
  RUNTIME_ERROR_SIGSEGV: 7,
  RUNTIME_ERROR_SIGXFSZ: 8,
  RUNTIME_ERROR_SIGFPE: 9,
  RUNTIME_ERROR_SIGABRT: 10,
  RUNTIME_ERROR_NZEC: 11,
  RUNTIME_ERROR_OTHER: 12,
  INTERNAL_ERROR: 13,
  EXEC_FORMAT_ERROR: 14
}

LANGUAGE_IDS = {
  python: 71,       # Python 3.10
  java: 62,         # Java 11
  javascript: 63,   # JavaScript (Node.js 12.14.0)
}

ROLE = {
  ADMIN: "admin",
  STUDENT: "student"
}

QUESTION_TYPE = {
  MCQ: "mcq",
  CODING: "coding"
}

RESULTS_VISIBILITY = {
  HIDDEN: "hidden",
  VISIBLE: "visible"
}