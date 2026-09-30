/* eslint-disable @typescript-eslint/no-explicit-any */

export class InProcessWorkerPool {
  constructor(private readonly load: () => (task: any) => Promise<any>) {}

  run = jest.fn((task: any) => this.load()(task));

  reset(): void {
    this.run.mockReset();
    this.run.mockImplementation((task: any) => this.load()(task));
  }

  async onModuleDestroy(): Promise<void> {}
}
