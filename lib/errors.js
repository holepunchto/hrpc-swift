'use strict'

module.exports = class CodegenError extends Error {
  constructor(msg, code, fn = CodegenError) {
    super(`${code}: ${msg}`)
    this.code = code

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, fn)
    }
  }

  get name() {
    return 'CodegenError'
  }

  static INVALID_HANDLER_NAME(msg) {
    return new CodegenError(msg, 'INVALID_HANDLER_NAME', CodegenError.INVALID_HANDLER_NAME)
  }

  static DUPLICATE_METHOD_NAME(msg) {
    return new CodegenError(msg, 'DUPLICATE_METHOD_NAME', CodegenError.DUPLICATE_METHOD_NAME)
  }

  static STREAM_WITHOUT_RESPONSE(msg) {
    return new CodegenError(msg, 'STREAM_WITHOUT_RESPONSE', CodegenError.STREAM_WITHOUT_RESPONSE)
  }

  static MISSING_RESPONSE(msg) {
    return new CodegenError(msg, 'MISSING_RESPONSE', CodegenError.MISSING_RESPONSE)
  }

  static UNSUPPORTED_TYPE(msg) {
    return new CodegenError(msg, 'UNSUPPORTED_TYPE', CodegenError.UNSUPPORTED_TYPE)
  }

  static RESERVED_KEYWORD(msg) {
    return new CodegenError(msg, 'RESERVED_KEYWORD', CodegenError.RESERVED_KEYWORD)
  }
}
