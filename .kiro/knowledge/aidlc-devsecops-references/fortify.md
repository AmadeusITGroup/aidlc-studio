# Fortify (SAST) Reference (on-demand)

> **On-demand reference for the devsecops agent.** Consult this for Fortify
> translate flavors and per-language guidance (Python, Go, JS/TS, mixed). The
> compact Fortify summary lives in
> `../aidlc-devsecops-agent/devsecops-pipeline-patterns.md`.
>
> **Only use with a Security Center session** — results are not visible in the console.

## Workflow

```bash
eve scan fortify start
eve scan fortify translate <flavor> <target>
eve scan fortify analyse
```

## Translate Flavors

| Flavor | Command |
|--------|---------|
| Python | `eve scan fortify translate python <pkg> --path <venv_path> --version 3` |
| Maven | `eve scan fortify translate maven <dir>` |
| JavaScript / TypeScript | `eve scan fortify translate native -- <src_dir>` |
| Go | `eve scan fortify translate wrapper -- "sourceanalyzer" "-b" "@BUILD_ID@" "."` |
| Native | `eve scan fortify translate native -- <sourceanalyzer_params>` |

---

## Fortify for JavaScript / TypeScript Projects

JavaScript and TypeScript projects (Angular, React, Node.js, etc.) use the `native` translate flavor. There is **no dedicated `js` or `typescript` flavor** — EVE's `native` mode passes arguments directly to `sourceanalyzer`, which auto-detects JS/TS/HTML files.

> **Important:** The `-b` (build ID) flag is automatically injected by EVE when using `native`. Do **NOT** pass `-b @BUILD_ID@` manually — this will cause a "Duplicate occurrence of command line option -b" error.

```bash
eve scan fortify start
eve scan fortify translate native -- src
eve scan fortify analyse
```

**Parameters:**
- `src` — Path to the source directory containing JS/TS/HTML files (e.g., `src`, `.`, or `app`)

**Excluding directories** (e.g., `node_modules`, test files, build output):

```bash
eve scan fortify translate native -- -exclude "**/node_modules/**" -exclude "**/dist/**" -exclude "**/*.spec.ts" src
```

**`.eve/config.toml` section** (optional, for documentation purposes):

```toml
[scan.fortify.translate.js]
# Angular/TypeScript project — Fortify JS flavor covers TS/JS/HTML
```

**Key points:**
- Fortify's JS frontend handles `.ts`, `.js`, `.html`, `.jsx`, `.tsx` files automatically
- No build step is required — sourceanalyzer parses source files directly
- Typical findings include: Cross-Site Scripting (DOM), Open Redirect, Privacy Violation, Path Manipulation
- Check translated file count with: `eve scan fortify translate native -- -show-files`

---

## Fortify for Python Projects

Python uses the dedicated `python` flavor with virtual environment path. **Always exclude the venv directory from source scanning** using native Fortify `-exclude` parameters after the `--` separator.

> **The `--path` option is REQUIRED for Python translate.** It must point to a `site-packages` directory. If the project has no virtual environment, use the **system site-packages** as a fallback:
> ```bash
> python3 -c "import site; print(site.getsitepackages()[0])"
> ```
> Alternatively, use `--executable` to point to the Python binary instead of `--path`:
> ```bash
> eve scan fortify translate python ./src --executable $(which python3) --version 3
> ```

```bash
eve scan fortify start
eve scan fortify translate python ./src --path .venv/lib/python3.12/site-packages --version 3 -- -exclude "**/.venv/**" -exclude "**/venv/**" -exclude "**/__pycache__/**"
eve scan fortify analyse
```

**Parameters:**
- `./src` - Path to Python source code
- `--path` - Path to site-packages in virtual environment
- `--version 3` - Python version (2 or 3)
- `-- -exclude "**/.venv/**"` - Exclude project venv from source scanning (native Fortify parameter)
- `-exclude "**/venv/**"` - Exclude alternate venv directory name
- `-exclude "**/__pycache__/**"` - Exclude Python cache directories

**Finding your site-packages path:**
```bash
python -c "import site; print(site.getsitepackages()[0])"
```

---

## Fortify for Go Projects

Go requires the `wrapper` method with `sourceanalyzer` - the standard flavors don't support Go directly.

**Single Go module:**
```bash
eve scan fortify start
cd <go-module-dir>
eve scan fortify translate wrapper -- "sourceanalyzer" "-b" "@BUILD_ID@" "."
eve scan fortify analyse
```

**Multiple Go modules (monorepo):**
```bash
eve scan fortify start

# Translate each module directory
cd module1 && eve scan fortify translate wrapper -- "sourceanalyzer" "-b" "@BUILD_ID@" "."
cd ../module2 && eve scan fortify translate wrapper -- "sourceanalyzer" "-b" "@BUILD_ID@" "."
cd ../module3 && eve scan fortify translate wrapper -- "sourceanalyzer" "-b" "@BUILD_ID@" "."

# Run analysis once for all translated files
eve scan fortify analyse
```

**Key points:**
- `@BUILD_ID@` is automatically replaced by EVE with the current build ID
- Run translate from **inside each Go module directory** (where `go.mod` is located)
- The `.` tells sourceanalyzer to scan the current directory
- Check translated files with: `eve scan fortify translate native -- -show-files`

---

## Fortify for Mixed-Language Projects (Go + Python)

When scanning Go projects that contain Python scripts, Fortify may report warnings like:

```
12004: The Python frontend was unable to resolve the following import: csv, argparse...
12007: You may need to add some arguments to the -python-path argument to SCA.
```

**Solution 1: Exclude Python files (recommended if Python is not the main language)**

```bash
eve scan fortify translate wrapper -- "sourceanalyzer" "-b" "@BUILD_ID@" "-exclude" "**/*.py" "."
```

**Solution 2: Add Python standard library path (if you need to scan Python too)**

Find your Python standard library path:
```bash
python -c "import sys; print([p for p in sys.path if 'lib/python' in p][0])"
```

Then include it in the scan:
```bash
eve scan fortify translate wrapper -- "sourceanalyzer" "-b" "@BUILD_ID@" "-python-path" "/usr/local/lib/python3.12" "."
```

**Solution 3: Separate scans for each language**

```bash
eve scan fortify start

# Scan Go modules
cd go-module && eve scan fortify translate wrapper -- "sourceanalyzer" "-b" "@BUILD_ID@" "-exclude" "**/*.py" "."

# Scan Python separately with proper venv (always exclude venv directories)
cd ../python-module && eve scan fortify translate python . --path .venv/lib/python3.12/site-packages --version 3 -- -exclude "**/.venv/**" -exclude "**/venv/**" -exclude "**/__pycache__/**"

eve scan fortify analyse
```

> **Note:** Warnings 12004/12007 are informational - they indicate Fortify couldn't fully analyze Python imports but the scan still completes. If Python is not your main language, these warnings can be safely ignored or suppressed using the exclude option.
