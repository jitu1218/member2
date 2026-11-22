/**
 * ProofPatch MCP Server — Shared Types
 *
 * Core type definitions for workspace inspection, file reading,
 * search results, symbol discovery, and context evidence.
 */
/** Global server configuration */
export interface ServerConfig {
    /** Absolute path to the workspace root directory */
    workspaceRoot: string;
    /** Maximum file size (bytes) to read; defaults to 1 MB */
    maxFileSizeBytes: number;
    /** Maximum number of lines returned by a single read-file call */
    maxReadLines: number;
    /** Maximum number of search results returned */
    maxSearchResults: number;
    /** Context lines before/after a search match */
    searchContextLines: number;
    /** Search timeout in milliseconds */
    searchTimeoutMs: number;
    /** Maximum context budget in characters for automatic retrieval */
    contextBudgetChars: number;
    /** Additional paths to exclude (beyond defaults) */
    additionalExcludePaths: string[];
}
/** Default configuration values */
export declare const DEFAULT_CONFIG: ServerConfig;
/**
 * Default patterns excluded from file listing and search.
 * Matches directories/files that are typically irrelevant or sensitive.
 */
export declare const DEFAULT_EXCLUDE_PATTERNS: readonly string[];
/**
 * File patterns considered sensitive and excluded from reading by default.
 * These may contain secrets, keys, or credentials.
 */
export declare const SENSITIVE_FILE_PATTERNS: readonly string[];
/**
 * Binary file extensions that should not be read as text.
 */
export declare const BINARY_EXTENSIONS: ReadonlySet<string>;
/** Input parameters for the list-files tool */
export interface ListFilesInput {
    /** Optional subdirectory (relative to workspace root) to list */
    directory?: string;
    /** Optional glob pattern to filter files, e.g. *.py or **\/*.ts */
    pattern?: string;
    /** Maximum number of files to return; default 200 */
    maxResults?: number;
    /** Include hidden files (dotfiles); default false */
    includeHidden?: boolean;
}
/** A single file entry in the listing */
export interface FileEntry {
    /** Path relative to workspace root */
    relativePath: string;
    /** File extension (lowercase, with dot) or empty string */
    extension: string;
    /** File size in bytes */
    sizeBytes: number;
    /** Whether this is a directory */
    isDirectory: boolean;
}
/** Output from the list-files tool */
export interface ListFilesOutput {
    /** The workspace root that paths are relative to */
    workspaceRoot: string;
    /** Listed files */
    files: FileEntry[];
    /** Total files found before truncation */
    totalFound: number;
    /** Whether results were truncated */
    truncated: boolean;
    /** Number of files excluded by ignore rules */
    excludedCount: number;
}
/** Input parameters for the read-file tool */
export interface ReadFileInput {
    /** File path, relative to workspace root */
    path: string;
    /** Start line (1-based, inclusive) */
    startLine?: number;
    /** End line (1-based, inclusive) */
    endLine?: number;
    /** Maximum number of lines to return; overrides config default */
    maxLines?: number;
}
/** Output from the read-file tool */
export interface ReadFileOutput {
    /** Path relative to workspace root */
    relativePath: string;
    /** File content (may be a range) */
    content: string;
    /** Total number of lines in the file */
    totalLines: number;
    /** Starting line number of the returned content (1-based) */
    startLine: number;
    /** Ending line number of the returned content (1-based) */
    endLine: number;
    /** File size in bytes */
    sizeBytes: number;
    /** Whether content was truncated by the line limit */
    truncated: boolean;
    /** Truncation message, if applicable */
    truncationMessage?: string;
}
/** Input parameters for the text-search tool */
export interface TextSearchInput {
    /** Search query string */
    query: string;
    /** Optional file glob filter (e.g., "*.py") */
    filePattern?: string;
    /** Whether the search is case-sensitive; default false */
    caseSensitive?: boolean;
    /** Whether the query is a regex; default false */
    isRegex?: boolean;
    /** Maximum number of results; overrides config default */
    maxResults?: number;
    /** Number of context lines before/after each match */
    contextLines?: number;
}
/** A single search match */
export interface SearchMatch {
    /** File path relative to workspace root */
    relativePath: string;
    /** 1-based line number of the match */
    lineNumber: number;
    /** The matched line content */
    lineContent: string;
    /** Context lines before the match */
    contextBefore: string[];
    /** Context lines after the match */
    contextAfter: string[];
}
/** Output from the text-search tool */
export interface TextSearchOutput {
    /** The search query */
    query: string;
    /** Search matches */
    matches: SearchMatch[];
    /** Total matches found before truncation */
    totalMatches: number;
    /** Whether results were truncated */
    truncated: boolean;
    /** Files searched */
    filesSearched: number;
    /** Search duration in milliseconds */
    durationMs: number;
}
/** Confidence level for a discovered symbol or reference */
export type SymbolConfidence = 'confirmed' | 'likely' | 'possible';
/** Kinds of symbols we can discover */
export type SymbolKind = 'function' | 'class' | 'method' | 'import' | 'decorator' | 'variable' | 'module' | 'unknown';
/** A discovered symbol with location information */
export interface SymbolInfo {
    /** Symbol name */
    name: string;
    /** Kind of symbol */
    kind: SymbolKind;
    /** File path relative to workspace root */
    relativePath: string;
    /** 1-based start line */
    startLine: number;
    /** 1-based end line */
    endLine: number;
    /** Confidence in this symbol's classification */
    confidence: SymbolConfidence;
    /** Parent symbol (for methods inside classes) */
    parent?: string;
    /** Decorators applied to this symbol */
    decorators?: string[];
    /** Parameters (for functions/methods) */
    parameters?: string[];
    /** Import source (for imports) */
    importSource?: string;
}
/** Output from symbol discovery */
export interface SymbolDiscoveryOutput {
    /** File path relative to workspace root */
    relativePath: string;
    /** Language detected */
    language: string;
    /** Discovered symbols */
    symbols: SymbolInfo[];
    /** Whether the analysis is complete or partial */
    analysisComplete: boolean;
    /** Limitations of the analysis */
    limitations: string[];
}
export type ReferenceKind = 'file' | 'symbol';
export type ReferenceStatus = 'resolved' | 'ambiguous' | 'not_found' | 'invalid';
export interface ExplicitReference {
    raw: string;
    kind: ReferenceKind;
    target: string;
}
export interface ResolvedFileReference {
    raw: string;
    kind: 'file';
    status: ReferenceStatus;
    target: string;
    relativePath?: string;
    content?: string;
    totalLines?: number;
    sizeBytes?: number;
    error?: string;
}
export interface ResolvedSymbolReference {
    raw: string;
    kind: 'symbol';
    status: ReferenceStatus;
    target: string;
    matches: SymbolInfo[];
    selectedMatch?: SymbolInfo;
    snippet?: string;
    error?: string;
}
export type ResolvedReference = ResolvedFileReference | ResolvedSymbolReference;
export interface ResolveReferencesOutput {
    references: ResolvedReference[];
    totalResolved: number;
    totalAmbiguous: number;
    totalNotFound: number;
    totalErrors: number;
}
/** Why a file or symbol was selected or excluded */
export type SelectionReason = 'explicit_reference' | 'text_match' | 'symbol_definition' | 'import_reference' | 'likely_caller' | 'test_file' | 'config_file' | 'path_relevance' | 'dependency_hint';
/** A single selected or excluded context item */
export interface ContextItem {
    /** File path relative to workspace root */
    relativePath: string;
    /** Selected symbol name, if specific */
    symbol?: string;
    /** Line range, if specific */
    startLine?: number;
    endLine?: number;
    /** Why this was selected or excluded */
    reason: SelectionReason;
    /** Human-readable evidence description */
    evidence: string;
    /** Approximate size in characters */
    sizeChars: number;
}
/** The context evidence trail */
export interface ContextEvidence {
    /** Items selected for context */
    selected: ContextItem[];
    /** Items considered but excluded */
    excluded: ContextItem[];
    /** Total budget in characters */
    budgetChars: number;
    /** Budget used in characters */
    usedChars: number;
    /** Retrieval methods used */
    methods: string[];
    /** Limitations of the retrieval */
    limitations: string[];
}
/** Output for automatic context retrieval */
export interface AutoContextOutput {
    /** Assembled context snippets ready for prompt / agent consumption */
    contextPieces: {
        relativePath: string;
        symbol?: string;
        startLine?: number;
        endLine?: number;
        content: string;
        reason: SelectionReason;
        evidence: string;
    }[];
    /** Grounded Context Evidence Trail explaining why each file was selected/omitted */
    evidenceTrail: ContextEvidence;
}
/**
 * PROVISIONAL: Interface for reading files through the workspace overlay.
 *
 * Member 4 owns the actual WorkspaceView / overlay implementation.
 * This provisional adapter allows our tools to read either:
 * - The real filesystem (before overlay integration)
 * - The staged/overlay view (after Member 4 provides the real interface)
 *
 * TODO: Replace with Member 4's actual WorkspaceView interface.
 */
export interface WorkspaceViewAdapter {
    /** Read a file's content. Returns the overlay version if staged changes exist. */
    readFile(absolutePath: string): Promise<string>;
    /** Check if a file exists (in overlay or on disk) */
    fileExists(absolutePath: string): Promise<boolean>;
    /** Get file stats (size, etc.) */
    fileStat(absolutePath: string): Promise<{
        size: number;
        isFile: boolean;
        isDirectory: boolean;
    } | null>;
    /** List directory contents */
    readDirectory(absolutePath: string): Promise<string[]>;
    /** Check if the adapter has active in-memory staged changes */
    hasStagedChanges?(): boolean;
}
/** Standard error codes for tool failures */
export type ToolErrorCode = 'PATH_OUTSIDE_WORKSPACE' | 'PATH_TRAVERSAL_ATTEMPT' | 'FILE_NOT_FOUND' | 'FILE_TOO_LARGE' | 'BINARY_FILE' | 'SENSITIVE_FILE' | 'PERMISSION_DENIED' | 'INVALID_INPUT' | 'SEARCH_TIMEOUT' | 'PARSE_ERROR' | 'UNSUPPORTED_LANGUAGE' | 'SYMBOL_NOT_FOUND' | 'AMBIGUOUS_SYMBOL' | 'INTERNAL_ERROR';
/** Structured error response from tools */
export interface ToolError {
    code: ToolErrorCode;
    message: string;
    path?: string;
    details?: string;
}
//# sourceMappingURL=index.d.ts.map