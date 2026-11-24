// Suggests a project's test command from what lies at its top level. Only a suggestion: the person
// confirms it in the panel before anything runs. Pure (the caller passes the file listing and a
// reader), so it is tested in CI.

export interface ProjectFiles {
  /** File and folder names at the repository's top level. */
  names: readonly string[]
  /** The text of a top-level file, or null. */
  read(name: string): Promise<string | null>
}

export interface TestSuggestion {
  command: string
  /** Why, in a few words for the panel. */
  because: string
}

/** package.json scripts worth running after a merge, in this order. */
const SCRIPT_ORDER = ['test', 'test:unit', 'test:ci', 'test:all'] as const

/** npm writes this placeholder into a fresh package.json; it is no test suite. */
const NPM_PLACEHOLDER = /no test specified/i

export async function detectTestCommand(files: ProjectFiles): Promise<TestSuggestion | null> {
  const has = (name: string) => files.names.includes(name)

  if (has('package.json')) {
    const pkg = parseJson(await files.read('package.json'))
    const scripts = (pkg?.scripts ?? {}) as Record<string, unknown>
    // The fast suites first; end-to-end runs (test:e2e) are too slow to follow every merge.
    const name = SCRIPT_ORDER.find((n) => {
      const s = scripts[n]
      return typeof s === 'string' && s.trim() && !NPM_PLACEHOLDER.test(s)
    })
    if (name) {
      const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') || has('bun.lock') ? 'bun' : 'npm'
      const command = name === 'test' && pm !== 'bun' ? `${pm} test` : `${pm} run ${name}`
      return { command, because: `package.json hat das Skript „${name}“` }
    }
  }
  if (has('Cargo.toml')) return { command: 'cargo test', because: 'Rust-Projekt (Cargo.toml)' }
  if (has('go.mod')) return { command: 'go test ./...', because: 'Go-Modul (go.mod)' }
  if (has('deno.json') || has('deno.jsonc')) return { command: 'deno test', because: 'Deno-Projekt' }
  if (has('pytest.ini') || has('conftest.py')) return { command: 'pytest', because: 'pytest-Konfiguration' }
  if (has('pyproject.toml') && /pytest/.test((await files.read('pyproject.toml')) ?? '')) {
    return { command: 'pytest', because: 'pyproject.toml nennt pytest' }
  }
  if (files.names.some((n) => /\.(sln|slnx|csproj|fsproj)$/i.test(n))) return { command: 'dotnet test', because: '.NET-Projekt' }
  if (has('Makefile') && /^test\s*:/m.test((await files.read('Makefile')) ?? '')) {
    return { command: 'make test', because: 'Makefile hat ein test-Ziel' }
  }
  if (has('gradlew') || has('gradlew.bat')) return { command: process.platform === 'win32' ? 'gradlew.bat test' : './gradlew test', because: 'Gradle-Wrapper' }
  if (has('pom.xml')) return { command: 'mvn test', because: 'Maven-Projekt (pom.xml)' }
  return null
}

function parseJson(text: string | null): Record<string, unknown> | null {
  if (!text) return null
  try {
    const v = JSON.parse(text) as unknown
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}
