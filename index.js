'use strict'

const HRPCBuilder = require('hrpc')
const writeToDisk = require('./lib/write')

class SwiftHRPC extends HRPCBuilder {
  static toDisk(hrpc, dir, opts = {}) {
    // Mirror parent argument-shifting: if dir is an object, treat it as opts
    if (typeof dir === 'object' && dir !== null && !Array.isArray(dir)) {
      opts = dir
      dir = null
    }
    if (!dir) dir = hrpc.hrpcDir
    writeToDisk(hrpc, dir, opts)
  }
}

module.exports = SwiftHRPC
