# Python Rules

- Follow PEP 8 — use `ruff` for formatting and linting
- Use type hints on all function signatures and public methods
- Use `pathlib` over `os.path` for path manipulation
- Prefer dataclasses over plain dicts for structured data
- Use `async def` for I/O-bound functions, with proper `asyncio` patterns
- Use context managers (`with` statements) for resource handling
- No wildcard imports (`from module import *`)
- Use `__all__` to define public API surface of modules