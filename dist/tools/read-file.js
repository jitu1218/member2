/**
 * ProofPatch MCP Server — read-file Tool
 *
 * Reads file content with safety checks:
 * - Path traversal prevention
 * - Workspace boundary enforcement
 * - Sensitive file exclusion
 * - Binary file detection
 * - Size limits
 * - Line range reads
 * - Truncation indicators
 */
import { hasTraversalAttempt, isBinaryFile, isSensitiveFile, resolveWorkspacePath, toRelativePath, } from './path-utils.js';
/**
 * Read file content with comprehensive safety checks.
 */
export async function readFile(input, config, adapter) {
    // ── Validate path ────────────────────────────────────────────
    // Check for explicit traversal attempts first (even before resolution)
    if (hasTraversalAttempt(input.path)) {
        return {
            error: {
                code: 'PATH_TRAVERSAL_ATTEMPT',
                message: `Path contains traversal sequences: "${input.path}"`,
                path: input.path,
            },
        };
    }
    // Resolve to absolute path and check workspace bounds
    const resolved = resolveWorkspacePath(config.workspaceRoot, input.path);
    if ('error' in resolved)
        return resolved;
    const { absolutePath } = resolved;
    const relativePath = toRelativePath(config.workspaceRoot, absolutePath);
    // ── Check file safety ────────────────────────────────────────
    // Sensitive files
    if (isSensitiveFile(absolutePath)) {
        return {
            error: {
                code: 'SENSITIVE_FILE',
                message: `File "${relativePath}" matches a sensitive file pattern and is excluded by default.`,
                path: relativePath,
                details: 'This file may contain secrets or credentials. If you need to read it, ask the developer explicitly.',
            },
        };
    }
    // Binary files
    if (isBinaryFile(absolutePath)) {
        return {
            error: {
                code: 'BINARY_FILE',
                message: `File "${relativePath}" appears to be a binary file and cannot be read as text.`,
                path: relativePath,
            },
        };
    }
    // ── Check existence and size ─────────────────────────────────
    const stat = await adapter.fileStat(absolutePath);
    if (!stat) {
        return {
            error: {
                code: 'FILE_NOT_FOUND',
                message: `File not found: "${relativePath}"`,
                path: relativePath,
            },
        };
    }
    if (stat.isDirectory) {
        return {
            error: {
                code: 'INVALID_INPUT',
                message: `Path is a directory, not a file: "${relativePath}"`,
                path: relativePath,
            },
        };
    }
    if (stat.size > config.maxFileSizeBytes) {
        return {
            error: {
                code: 'FILE_TOO_LARGE',
                message: `File "${relativePath}" is ${stat.size} bytes, exceeding the ${config.maxFileSizeBytes} byte limit.`,
                path: relativePath,
                details: `Use startLine/endLine to read a specific range.`,
            },
        };
    }
    // ── Read file content ────────────────────────────────────────
    let content;
    try {
        content = await adapter.readFile(absolutePath);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('EACCES') || message.includes('EPERM')) {
            return {
                error: {
                    code: 'PERMISSION_DENIED',
                    message: `Permission denied reading "${relativePath}".`,
                    path: relativePath,
                },
            };
        }
        return {
            error: {
                code: 'INTERNAL_ERROR',
                message: `Failed to read file "${relativePath}": ${message}`,
                path: relativePath,
            },
        };
    }
    // ── Apply line range ─────────────────────────────────────────
    const allLines = content.split('\n');
    const totalLines = allLines.length;
    const maxLines = input.maxLines ?? config.maxReadLines;
    let startLine = input.startLine ?? 1;
    let endLine = input.endLine ?? totalLines;
    // Clamp to valid range
    startLine = Math.max(1, Math.min(startLine, totalLines));
    endLine = Math.max(startLine, Math.min(endLine, totalLines));
    // Apply line limit
    let truncated = false;
    let truncationMessage;
    if (endLine - startLine + 1 > maxLines) {
        endLine = startLine + maxLines - 1;
        truncated = true;
        truncationMessage = `Content truncated to ${maxLines} lines (lines ${startLine}–${endLine} of ${totalLines}). Use startLine/endLine to read the remaining content.`;
    }
    // Extract the requested lines (convert from 1-based to 0-based)
    const selectedLines = allLines.slice(startLine - 1, endLine);
    const outputContent = selectedLines.join('\n');
    return {
        relativePath,
        content: outputContent,
        totalLines,
        startLine,
        endLine,
        sizeBytes: stat.size,
        truncated,
        truncationMessage,
    };
}
//# sourceMappingURL=read-file.js.map