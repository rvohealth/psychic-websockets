import path from 'node:path'
import ts from 'typescript'

// Exercise the published declaration boundary without requiring a previous build.
describe('PsychicAppWebsockets production declarations', () => {
  it('keeps Redis types usable by peers without generic Redis classes', () => {
    const configPath = path.resolve('tsconfig.esm.build.json')
    const config = ts.readConfigFile(configPath, ts.sys.readFile)
    expect(config.error).toBeUndefined()
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath))
    expect(parsed.errors).toEqual([])

    const program = ts.createProgram(parsed.fileNames, {
      ...parsed.options,
      emitDeclarationOnly: true,
    })
    const diagnostics = ts.getPreEmitDiagnostics(program)
    expect(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: filename => filename,
        getCurrentDirectory: ts.sys.getCurrentDirectory,
        getNewLine: () => '\n',
      }),
    ).toBe('')

    let declaration: string | undefined
    const outputPath = path.resolve('dist/types/src/psychic-app-websockets/index.d.ts')
    const emitted = program.emit(undefined, (filename, text) => {
      if (path.resolve(filename) === outputPath) declaration = text
    })
    expect(emitted.emitSkipped).toBe(false)
    expect(declaration).toBeDefined()

    const source = ts.createSourceFile(outputPath, declaration!, ts.ScriptTarget.Latest, true)
    const app = source.statements.find(ts.isClassDeclaration)!
    const connection = app.members.find(
      member => ts.isGetAccessorDeclaration(member) && member.name.getText(source) === 'connection',
    ) as ts.GetAccessorDeclaration
    expect(connection.type?.getText(source)).toBe('Redis')

    const subscriber = app.members.find(
      member => ts.isGetAccessorDeclaration(member) && member.name.getText(source) === 'subConnection',
    ) as ts.GetAccessorDeclaration
    expect(subscriber.type?.getText(source)).toBe('RedisOrRedisClusterConnection')
    const subscriberType = source.statements.find(
      statement =>
        ts.isTypeAliasDeclaration(statement) && statement.name.text === 'RedisOrRedisClusterConnection',
    ) as ts.TypeAliasDeclaration
    expect(subscriberType.type.getText(source)).toBe('Redis | Cluster')
  }, 30_000)
})
