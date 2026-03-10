declare module 'sql.js' {
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => Database
  }

  interface Database {
    run(sql: string, params?: any[]): Database
    exec(sql: string, params?: any[]): QueryExecResult[]
    prepare(sql: string): Statement
    close(): void
    export(): Uint8Array
  }

  interface Statement {
    run(params?: any[]): boolean
    free(): boolean
    getAsObject(params?: any[]): Record<string, any>
  }

  interface QueryExecResult {
    columns: string[]
    values: any[][]
  }

  interface SqlJsConfig {
    locateFile?: (file: string) => string
  }

  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>
}
