import HRPCBuilder from 'hrpc'

interface WriteToDiskOptions {
  schemaPackagePath?: string
  schemaPackageName?: string
  schemaPackageId?: string
}

declare class SwiftHRPC extends HRPCBuilder {
  static toDisk(
    hrpc: HRPCBuilder,
    dir?: string | WriteToDiskOptions | null,
    opts?: WriteToDiskOptions
  ): void
}

export = SwiftHRPC
