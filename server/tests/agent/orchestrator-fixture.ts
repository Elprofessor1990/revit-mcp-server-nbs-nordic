/** esbuild substitutes only external boundaries, never the reviewed handlers. */
export const fixture = {
  command: async (_name: string, _args: any): Promise<any> => { throw new Error("Unexpected Revit call"); },
  request: async (_path: string): Promise<any> => { throw new Error("Unexpected NBS call"); },
  mappings: [] as unknown[][],
};
export async function withRevitConnection<T>(operation: (client: any) => Promise<T>): Promise<T> {
  return operation({ sendCommand: (name: string, args: any) => fixture.command(name, args) });
}
export const nbsClient = { request: (path: string) => fixture.request(path) };
export function dbRun(...args: unknown[]) { fixture.mappings.push(args); }
export function logTokenUsage() {}
