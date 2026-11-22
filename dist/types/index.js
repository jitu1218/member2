/**
 * ProofPatch MCP Server — Shared Types
 *
 * Core type definitions for workspace inspection, file reading,
 * search results, symbol discovery, and context evidence.
 */
/** Default configuration values */
export const DEFAULT_CONFIG = {
    workspaceRoot: '',
    maxFileSizeBytes: 1_048_576, // 1 MB
    maxReadLines: 500,
    maxSearchResults: 50,
    searchContextLines: 2,
    searchTimeoutMs: 10_000,
    contextBudgetChars: 100_000, // ~25k tokens
    additionalExcludePaths: [],
};
// ─── Ignore / Exclusion ──────────────────────────────────────────
/**
 * Default patterns excluded from file listing and search.
 * Matches directories/files that are typically irrelevant or sensitive.
 */
export const DEFAULT_EXCLUDE_PATTERNS = [
    'node_modules',
    '.git',
    '__pycache__',
    '.mypy_cache',
    '.pytest_cache',
    '.tox',
    '.nox',
    '.venv',
    'venv',
    'env',
    '.env',
    '.env.*',
    'dist',
    'build',
    'out',
    'coverage',
    '.coverage',
    '.nyc_output',
    '.next',
    '.nuxt',
    '.cache',
    '.parcel-cache',
    '.turbo',
    '*.pyc',
    '*.pyo',
    '*.egg-info',
    '*.egg',
    '.DS_Store',
    'Thumbs.db',
    '*.swp',
    '*.swo',
    '*~',
];
/**
 * File patterns considered sensitive and excluded from reading by default.
 * These may contain secrets, keys, or credentials.
 */
export const SENSITIVE_FILE_PATTERNS = [
    '.env',
    '.env.*',
    '*.pem',
    '*.key',
    '*.p12',
    '*.pfx',
    '*.jks',
    '*.keystore',
    'id_rsa',
    'id_ed25519',
    'id_dsa',
    '*.secret',
    'credentials.json',
    'service-account*.json',
    'secrets.yaml',
    'secrets.yml',
    '.netrc',
    '.npmrc',
    '.pypirc',
];
/**
 * Binary file extensions that should not be read as text.
 */
export const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
    '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flac', '.ogg', '.webm',
    '.zip', '.gz', '.tar', '.bz2', '.xz', '.7z', '.rar',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.exe', '.dll', '.so', '.dylib', '.o', '.a', '.lib',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.sqlite', '.db', '.sqlite3',
    '.pyc', '.pyo', '.class', '.jar', '.war',
    '.wasm',
]);
//# sourceMappingURL=index.js.map