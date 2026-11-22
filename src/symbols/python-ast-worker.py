#!/usr/bin/env python3
"""
AST-based symbol and reference extractor for Python code.
Reads source code from stdin, outputs JSON to stdout.
Extracts functions, classes, methods, imports, decorators, and call sites with line numbers.
"""

import ast
import json
import sys

def get_decorator_name(node):
    if isinstance(node, ast.Name):
        return node.id
    elif isinstance(node, ast.Attribute):
        parts = []
        curr = node
        while isinstance(curr, ast.Attribute):
            parts.append(curr.attr)
            curr = curr.value
        if isinstance(curr, ast.Name):
            parts.append(curr.id)
        return ".".join(reversed(parts))
    elif isinstance(node, ast.Call):
        return get_decorator_name(node.func)
    return "<decorator>"

def get_call_name(node):
    if isinstance(node, ast.Name):
        return node.id
    elif isinstance(node, ast.Attribute):
        parts = []
        curr = node
        while isinstance(curr, ast.Attribute):
            parts.append(curr.attr)
            curr = curr.value
        if isinstance(curr, ast.Name):
            parts.append(curr.id)
        return ".".join(reversed(parts))
    elif isinstance(node, ast.Call):
        return get_call_name(node.func)
    return None

class PythonSymbolVisitor(ast.NodeVisitor):
    def __init__(self, relative_path):
        self.relative_path = relative_path
        self.symbols = []
        self.calls = []
        self.scope_stack = []

    def visit_FunctionDef(self, node):
        self._handle_function(node, is_async=False)

    def visit_AsyncFunctionDef(self, node):
        self._handle_function(node, is_async=True)

    def _handle_function(self, node, is_async):
        is_method = len(self.scope_stack) > 0 and self.scope_stack[-1]["kind"] == "class"
        parent_name = self.scope_stack[-1]["name"] if is_method else None

        decorators = [get_decorator_name(d) for d in node.decorator_list]
        params = [arg.arg for arg in node.args.args]
        if node.args.vararg:
            params.append(f"*{node.args.vararg.arg}")
        if node.args.kwarg:
            params.append(f"**{node.args.kwarg.arg}")

        end_lineno = getattr(node, "end_lineno", node.lineno)

        self.symbols.append({
            "name": node.name,
            "kind": "method" if is_method else "function",
            "relativePath": self.relative_path,
            "startLine": node.lineno,
            "endLine": end_lineno,
            "confidence": "confirmed",
            "parent": parent_name,
            "decorators": decorators if decorators else None,
            "parameters": params,
            "isAsync": is_async
        })

        self.scope_stack.append({"name": node.name, "kind": "function"})
        self.generic_visit(node)
        self.scope_stack.pop()

    def visit_ClassDef(self, node):
        parent_class = self.scope_stack[-1]["name"] if len(self.scope_stack) > 0 and self.scope_stack[-1]["kind"] == "class" else None
        decorators = [get_decorator_name(d) for d in node.decorator_list]
        end_lineno = getattr(node, "end_lineno", node.lineno)

        self.symbols.append({
            "name": node.name,
            "kind": "class",
            "relativePath": self.relative_path,
            "startLine": node.lineno,
            "endLine": end_lineno,
            "confidence": "confirmed",
            "parent": parent_class,
            "decorators": decorators if decorators else None
        })

        self.scope_stack.append({"name": node.name, "kind": "class"})
        self.generic_visit(node)
        self.scope_stack.pop()

    def visit_Import(self, node):
        end_lineno = getattr(node, "end_lineno", node.lineno)
        for alias in node.names:
            name = alias.asname if alias.asname else alias.name
            self.symbols.append({
                "name": name,
                "kind": "import",
                "relativePath": self.relative_path,
                "startLine": node.lineno,
                "endLine": end_lineno,
                "confidence": "confirmed",
                "importSource": alias.name
            })

    def visit_ImportFrom(self, node):
        end_lineno = getattr(node, "end_lineno", node.lineno)
        module = node.module or ""
        if node.level > 0:
            module = "." * node.level + module

        for alias in node.names:
            name = alias.asname if alias.asname else alias.name
            self.symbols.append({
                "name": name,
                "kind": "import",
                "relativePath": self.relative_path,
                "startLine": node.lineno,
                "endLine": end_lineno,
                "confidence": "confirmed",
                "importSource": f"{module}.{alias.name}" if module else alias.name
            })

    def visit_Call(self, node):
        call_name = get_call_name(node.func)
        if call_name:
            end_lineno = getattr(node, "end_lineno", node.lineno)
            caller = self.scope_stack[-1]["name"] if self.scope_stack else None
            self.calls.append({
                "name": call_name,
                "startLine": node.lineno,
                "endLine": end_lineno,
                "caller": caller,
                "confidence": "possible"
            })
        self.generic_visit(node)

def main():
    try:
        data = json.load(sys.stdin)
        source = data.get("source", "")
        relative_path = data.get("relativePath", "")
    except Exception as e:
        print(json.dumps({
            "error": "Failed to read input JSON: " + str(e),
            "symbols": [],
            "calls": [],
            "analysisComplete": False,
            "limitations": [str(e)]
        }))
        return

    try:
        tree = ast.parse(source, filename=relative_path)
    except SyntaxError as e:
        print(json.dumps({
            "language": "python",
            "relativePath": relative_path,
            "symbols": [],
            "calls": [],
            "analysisComplete": False,
            "limitations": [f"Python syntax error at line {e.lineno}: {e.msg}"]
        }))
        return
    except Exception as e:
        print(json.dumps({
            "language": "python",
            "relativePath": relative_path,
            "symbols": [],
            "calls": [],
            "analysisComplete": False,
            "limitations": [f"Python parsing failed: {str(e)}"]
        }))
        return

    visitor = PythonSymbolVisitor(relative_path)
    visitor.visit(tree)

    print(json.dumps({
        "language": "python",
        "relativePath": relative_path,
        "symbols": visitor.symbols,
        "calls": visitor.calls,
        "analysisComplete": True,
        "limitations": [
            "Dynamic dispatch, reflection (getattr/setattr), and metaclasses cannot be statically resolved.",
            "Calls represent likely call expressions, not verified runtime control flow."
        ]
    }))

if __name__ == "__main__":
    main()
