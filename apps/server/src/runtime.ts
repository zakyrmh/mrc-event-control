export const supportedNodeMajor = 24

export function parseNodeMajor(version: string): number {
  const [major] = version.split('.')
  const parsedMajor = Number.parseInt(major ?? '', 10)

  if (!Number.isInteger(parsedMajor)) {
    throw new Error(`Invalid Node.js version: ${version}`)
  }

  return parsedMajor
}

export function assertSupportedNode(version = process.versions.node): void {
  const actualMajor = parseNodeMajor(version)

  if (actualMajor !== supportedNodeMajor) {
    throw new Error(
      `Unsupported Node.js ${version}; expected major ${supportedNodeMajor}`,
    )
  }
}
