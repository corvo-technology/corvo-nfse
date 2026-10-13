// Load the installed ESM SDK through Node 24, including its real XML/XSD/PDF code.
// This bridge bypasses Jest's CJS parser, rather than replacing SDK behavior.
export {};
module.exports = process
  .getBuiltinModule('module')
  .createRequire(process.cwd() + '/package.json')(
  'open-nfse',
) as typeof import('open-nfse');
