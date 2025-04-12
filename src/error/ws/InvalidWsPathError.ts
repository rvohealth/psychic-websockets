export default class InvalidWsPathError extends Error {
  constructor(private invalidPath: string) {
    super()
  }

  public get message() {
    return `
      Invalid path passed to Ws: "${this.invalidPath}"
    `
  }
}
