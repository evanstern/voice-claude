import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

interface ToolInfo {
  binary: string
  description: string
}

const KNOWN_TOOLS: ToolInfo[] = [
  { binary: 'git', description: 'version control' },
  { binary: 'curl', description: 'HTTP requests' },
  { binary: 'wget', description: 'file downloads' },
  { binary: 'jq', description: 'JSON processing' },
  { binary: 'rg', description: 'fast code search (ripgrep)' },
  { binary: 'tree', description: 'directory visualization' },
  { binary: 'make', description: 'build automation' },
  { binary: 'python3', description: 'Python scripting' },
  { binary: 'node', description: 'Node.js runtime' },
  { binary: 'gh', description: 'GitHub CLI' },
  { binary: 'docker', description: 'container management' },
  { binary: 'less', description: 'file paging' },
]

let cachedCapabilities: string | null = null

async function checkBinary(binary: string): Promise<boolean> {
  try {
    await execAsync(`which ${binary}`)
    return true
  } catch {
    return false
  }
}

export async function discoverEnvironment(): Promise<string> {
  if (cachedCapabilities !== null) {
    return cachedCapabilities
  }

  const results = await Promise.all(
    KNOWN_TOOLS.map(async (tool) => ({
      ...tool,
      available: await checkBinary(tool.binary),
    })),
  )

  const available = results.filter((r) => r.available)

  if (available.length === 0) {
    cachedCapabilities = ''
    return cachedCapabilities
  }

  const toolList = available
    .map((t) => `${t.binary} (${t.description})`)
    .join(', ')

  cachedCapabilities = `\nAvailable CLI tools: ${toolList}.`

  console.log(
    `[environment] discovered tools: ${available.map((t) => t.binary).join(', ')}`,
  )

  return cachedCapabilities
}
