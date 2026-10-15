// Load the installed ESM testing entrypoint through Node, including the real
// NfseClientFake. This bridge bypasses Jest's CJS parser, rather than
// replacing SDK behavior.
export {};
module.exports = process
  .getBuiltinModule('module')
  .createRequire(process.cwd() + '/package.json')(
  'open-nfse/testing',
) as typeof import('open-nfse/testing');
