interface Skip { skip: true; overlay: boolean }
interface Run { skip: false; sceneEntries: string[]; current: string }
type Prepared = Skip | Run
declare function prepare(): Promise<Prepared | undefined>
declare function use(r: Run): void
declare function hasPending(): boolean
async function test() {
  const context = await prepare()
  if (!context || context.skip) return
  const run: Run | undefined = context.skip ? undefined : context
  if (!run) return
  use(run)
}
declare const svc: { serial<T>(id: string, fn: () => Promise<T>): Promise<T> }
async function test2(id: string) {
  void svc.serial(id, async () => {
    if (hasPending()) return
    const context = await prepare()
    if (!context || context.skip) return
    const run: Run | undefined = context.skip ? undefined : context
    if (!run) return
    use(run)
  })
}
